// Builds the ordered list of managed components and their child environments.
//
// This module is where the queue pin lives end-to-end: the server is told to
// dispatch to RUNNER_TASK_QUEUE and the runner is told to poll RUNNER_TASK_QUEUE,
// both from the same constant, so the two can never drift. Setting the server's
// load-bearing env explicitly (ports, queues, db/storage paths) rather than
// relying on its compiled defaults makes the launch deterministic and the pin
// enforceable.

import { dirname, join } from "node:path";
import { RUNNER_TASK_QUEUE, RUNNER_READY_MARKER, SERVER_PID_FILE, RUNNER_PID_FILE, SERVER_PORT, TEMPORAL_NAMESPACE } from "../constants.js";
import { ARTIFACTS_SUBDIR } from "../paths.js";
import { waitForTcp } from "../net/tcp.js";
import { type ProviderReach, providerReach, runnerProvidersValue } from "../provider-reach.js";
import type { DaemonConfig } from "./env.js";
import type { ComponentSpec, ReadinessGate } from "./types.js";
import { GRACEFUL_STOP_TIMEOUT_MS } from "./supervisor.js";

/**
 * What the runner keeps of the supervisor's stop bound for its own exit
 * after its worker drains (releasing the harnesses, closing the Temporal
 * connection, flushing telemetry), so the drain ends before the kill.
 */
const RUNNER_EXIT_MARGIN_MS = 2_000;

/** How long the server has to open its gRPC port before startup aborts. */
const SERVER_GATE_TIMEOUT_MS = 30_000;

/** The server's setting naming the providers its runners reach (the server's `boot/config.ts`). */
export const RUNNER_PROVIDERS_ENV = "STIGMER_RUNNER_PROVIDERS";

/**
 * Environment for the `stigmer-server` child. Pins ports, Temporal coordinates,
 * the runner task queue, and the db/storage paths to the ~/.stigmer layout.
 */
export function buildServerEnv(config: DaemonConfig, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const configDir = dirname(config.dataDir); // ~/.stigmer
  const env: NodeJS.ProcessEnv = {
    ...base,
    GRPC_PORT: String(SERVER_PORT),
    TEMPORAL_HOST_PORT: config.temporalAddress,
    TEMPORAL_NAMESPACE,
    TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE: RUNNER_TASK_QUEUE,
    DB_PATH: join(configDir, "stigmer.db"),
    STORAGE_PATH: join(configDir, "storage"),
    // The artifact root the runner also reads (#285). Set explicitly rather
    // than relying on the server's compiled default so the shared-store contract
    // is visible and enforceable here, next to the runner's LOCAL_ARTIFACT_PATH.
    ARTIFACT_LOCAL_BASE_PATH: join(config.dataDir, ARTIFACTS_SUBDIR),
  };
  // Explicit set (after the base spread) so the launcher-resolved identity wins
  // over a stale inherited value — the delivery path for a `stigmer setup`-
  // persisted operator identity (oss#796; the ANTHROPIC_API_KEY precedent in
  // buildRunnerEnv). Server child only: the runner resolves caller identity
  // from the session's stamped created_by, never from its own env.
  if (config.operatorEmail !== undefined) env.STIGMER_OPERATOR_EMAIL = config.operatorEmail;
  if (config.operatorName !== undefined) env.STIGMER_OPERATOR_NAME = config.operatorName;
  // The providers the runner this daemon starts can reach, so the server
  // refuses a run that needs one it lacks at create, instead of the run
  // failing at its first model call (stigmer#1084). A value the operator
  // exported wins, an empty one included (it declares "none"); with no
  // runner here (`--server-only`) the server is told nothing and refuses
  // nothing, since a runner elsewhere is not this daemon's to judge.
  const reach = localRunnerReach(config, base);
  if (reach !== undefined && base[RUNNER_PROVIDERS_ENV] === undefined) {
    env[RUNNER_PROVIDERS_ENV] = runnerProvidersValue(reach);
  }
  return env;
}

/**
 * The providers the runner this daemon starts reaches, judged by the
 * runner's own rule over the very environment it is given, or undefined
 * when the daemon starts no runner.
 */
export function localRunnerReach(
  config: DaemonConfig,
  base: NodeJS.ProcessEnv = process.env,
): readonly ProviderReach[] | undefined {
  if (config.serverOnly || config.runner === undefined) return undefined;
  return providerReach(buildRunnerEnv(config, base));
}

/**
 * Environment for the unified runner child in static mode (STIGMER_RUNNER_MODE
 * left unset). The runner polls RUNNER_TASK_QUEUE — the corrected queue that the
 * server actually dispatches to.
 */
export function buildRunnerEnv(config: DaemonConfig, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    MODE: "local",
    STIGMER_BACKEND_ENDPOINT: `http://localhost:${SERVER_PORT}`,
    // The server's public address, from which the runner fills a declared
    // STIGMER_SERVER_ADDRESS for remote MCP servers too (stigmer/stigmer#1447).
    // On a local install it is the address the console and the CLI already
    // dial, the one the console page supplied before the platform owned it.
    STIGMER_MCP_PUBLIC_ENDPOINT: `http://localhost:${SERVER_PORT}`,
    TEMPORAL_SERVICE_ADDRESS: config.temporalAddress,
    TEMPORAL_NAMESPACE,
    WORKSPACE_ROOT_DIR: join(config.dataDir, "workspace"),
    STIGMER_TASK_QUEUE: RUNNER_TASK_QUEUE,
    LOG_LEVEL: base.LOG_LEVEL ?? "info",
    // Read artifacts from the exact directory the server writes to (#285). The
    // runner mints no download links (the server signs those), so it needs no
    // serve URL.
    ARTIFACT_STORAGE_TYPE: "local",
    LOCAL_ARTIFACT_PATH: join(config.dataDir, ARTIFACTS_SUBDIR),
    // The runner's drain grace (how long its shutdown lets a running turn
    // reach a step boundary) is kept under this supervisor's stop bound, after
    // which it is killed: a killed runner writes nothing, and its turn waits
    // out the workflow's heartbeat timeout before it continues.
    STIGMER_DRAIN_GRACE_MS: String(GRACEFUL_STOP_TIMEOUT_MS - RUNNER_EXIT_MARGIN_MS),
  };
  // Explicit set (after the base spread) so the launcher-resolved key wins over any
  // stale inherited value — the delivery path for a `stigmer setup`-persisted key.
  // The Anthropic key is the one `stigmer setup` saves. Every other way the
  // runner reaches a provider (OPENAI_API_KEY, a gateway, a cloud backend)
  // arrives through the base env spread above.
  if (config.anthropicApiKey !== undefined) env.ANTHROPIC_API_KEY = config.anthropicApiKey;
  if (config.activityRouting !== undefined) env.STIGMER_ACTIVITY_ROUTING = config.activityRouting;
  return env;
}

/**
 * Build the ordered components: `stigmer-server` (critical, gated on its gRPC
 * port) always first; the runner second unless server-only. Order matters — the
 * runner talks to the server.
 */
export function buildComponents(config: DaemonConfig, base: NodeJS.ProcessEnv = process.env): ComponentSpec[] {
  const components: ComponentSpec[] = [
    {
      name: "stigmer-server",
      pidFile: join(config.dataDir, SERVER_PID_FILE),
      critical: true,
      // The server is `node <entry>` — the runner's launch shape, one child
      // contract for both components.
      resolve: () => ({
        name: "stigmer-server",
        command: config.server.nodeBin,
        args: [config.server.entryPath],
        env: buildServerEnv(config, base),
        logFile: join(config.logDir, "stigmer-server.log"),
      }),
      gate: serverGate(),
    },
  ];

  if (config.serverOnly || config.runner === undefined) {
    return components;
  }

  const runner = config.runner;
  components.push({
    name: "runner",
    pidFile: join(config.dataDir, RUNNER_PID_FILE),
    critical: false,
    resolve: () => ({
      name: "runner",
      command: runner.nodeBin,
      args: [runner.entryPath],
      cwd: join(config.dataDir, "workspace"),
      env: buildRunnerEnv(config, base),
      logFile: join(config.logDir, "runner.log"),
      readinessMarker: RUNNER_READY_MARKER,
    }),
  });
  return components;
}

// The server is ready once its gRPC port accepts a connection; fail fast, with
// how it ended, if it exits first. The error is recorded under the component's
// name, so it speaks of "the server".
function serverGate(): ReadinessGate {
  return {
    description: `stigmer-server gRPC on port ${SERVER_PORT}`,
    wait: (handle) =>
      waitForTcp({
        port: SERVER_PORT,
        timeoutMs: SERVER_GATE_TIMEOUT_MS,
        label: "the server",
        getExit: () => handle.exitInfo(),
      }),
  };
}

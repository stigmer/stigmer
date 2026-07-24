// Builds the ordered list of managed components and their child environments.
//
// This module is where the queue pin lives end-to-end: the server is told to
// dispatch to RUNNER_TASK_QUEUE and the runner is told to poll RUNNER_TASK_QUEUE,
// both from the same constant, so the two can never drift. Setting the server's
// load-bearing env explicitly (ports, queues, db/storage paths) rather than
// relying on its compiled defaults makes the launch deterministic and the pin
// enforceable — mirroring test/e2e/fixtures/server-manager.ts.

import { dirname, join } from "node:path";
import { RUNNER_TASK_QUEUE, RUNNER_READY_MARKER, SERVER_PID_FILE, RUNNER_PID_FILE, SERVER_PORT, TEMPORAL_NAMESPACE } from "../constants.js";
import { waitForTcp } from "../net/tcp.js";
import type { DaemonConfig } from "./env.js";
import type { ComponentSpec, ReadinessGate } from "./types.js";

/** How long the server has to open its gRPC port before startup aborts. */
const SERVER_GATE_TIMEOUT_MS = 30_000;

/**
 * Environment for the `stigmer-server` child. Pins ports, Temporal coordinates,
 * both runner task queues, and the db/storage paths to the ~/.stigmer layout.
 */
export function buildServerEnv(config: DaemonConfig, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const configDir = dirname(config.dataDir); // ~/.stigmer
  return {
    ...base,
    GRPC_PORT: String(SERVER_PORT),
    TEMPORAL_HOST_PORT: config.temporalAddress,
    TEMPORAL_NAMESPACE,
    TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE: RUNNER_TASK_QUEUE,
    TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE: RUNNER_TASK_QUEUE,
    DB_PATH: join(configDir, "stigmer.db"),
    STORAGE_PATH: join(configDir, "storage"),
  };
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
    TEMPORAL_SERVICE_ADDRESS: config.temporalAddress,
    TEMPORAL_NAMESPACE,
    WORKSPACE_ROOT_DIR: join(config.dataDir, "workspace"),
    STIGMER_TASK_QUEUE: RUNNER_TASK_QUEUE,
    LOG_LEVEL: base.LOG_LEVEL ?? "info",
  };
  if (config.cursorApiKey !== undefined) env.CURSOR_API_KEY = config.cursorApiKey;
  // Explicit set (after the base spread) so the launcher-resolved key wins over any
  // stale inherited value — the delivery path for a `stigmer setup`-persisted key.
  // Anthropic only: it is the sole provider local execution supports. Other keys
  // (e.g. a shell-exported OPENAI_API_KEY for advanced per-agent gpt-* overrides)
  // still reach the runner through the base env spread above.
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
      resolve: () => ({
        command: config.serverBin,
        args: [],
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

// The server is ready once its gRPC port accepts a connection; fail fast if it
// exits first.
function serverGate(): ReadinessGate {
  return {
    description: `stigmer-server gRPC on port ${SERVER_PORT}`,
    wait: (handle) =>
      waitForTcp({
        port: SERVER_PORT,
        timeoutMs: SERVER_GATE_TIMEOUT_MS,
        label: "stigmer-server gRPC",
        getExit: () => (handle.hasExited() ? { code: null, signal: null } : null),
      }),
  };
}

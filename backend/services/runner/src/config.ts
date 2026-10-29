/**
 * Environment-based configuration for the unified runner service.
 *
 * Serves every harness's activity (`harness-adapters.ts`) from a single
 * process. All values come from environment variables set by the CLI daemon,
 * Kubernetes pod spec, or Daytona sandbox launcher.
 *
 * Credential modes:
 *
 * 1. Direct mode (local / OSS):
 *    - STIGMER_TOKEN is optional against a trusted-local server (it verifies
 *      no credential) and is the runner's own API key against a self-hosted
 *      server with sign-in on; each run's credential arrives with its
 *      dispatch (shared/run-credential.ts).
 *    - STIGMER_PROXY_ENDPOINT is NOT set.
 *
 * 2. Proxy mode (cloud / managed runners):
 *    - STIGMER_PROXY_ENDPOINT + STIGMER_TOKEN are required.
 *    - Model calls go to the platform's proxy, which holds the provider
 *      keys; the local agent proxy forwards them there with STIGMER_TOKEN
 *      (`agent-proxy/lanes.ts`).
 *
 * The credential is never held by value:
 *
 * The control-plane credential rotates while the process runs (the manager's
 * `updateToken` on a host refresh, the static root's
 * sandbox-token renewal), so `Config` carries it as a shared {@link TokenRef}
 * and nothing else. Every reader resolves `ref.current` at the moment of use;
 * a client that makes many requests over its life holds the ref and reads it
 * per request (the artifact store, the checkpoint saver). The two roots own
 * the writable ref; readers see it through `Readonly`, so a rotation has one
 * writer and no copy to go stale. {@link loadConfig} is the environment
 * boundary and is read once, by `main.ts`: the ref it returns holds the boot
 * capture that the roots turn into the live ref (a test pins that no other
 * module imports it).
 *
 * Workspace isolation:
 *
 * WORKSPACE_ROOT_DIR must always resolve to a directory that is NOT the
 * runner's own app directory. Falling back to process.cwd() would expose
 * runner internals to agents. The fallback creates an isolated directory.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

/**
 * Default no-progress bound for every harness's engine stream (ms), armed by
 * the turn runtime for every engine since #1070. It bounds a turn with nothing open and nothing
 * arriving: an open operation holds the window (`harness/open-operations.ts`).
 * Single source of truth for env-loaded ({@link loadConfig}) and
 * options-mapped (runner / manager) config so the three construction sites
 * never drift.
 */
export const DEFAULT_CURSOR_STREAM_STALL_TIMEOUT_MS = 180_000;

/**
 * Default drain grace of a static runner's worker (ms), `Config.drainGraceMs`:
 * how long a shutdown waits for in-flight turns to reach a step boundary
 * before Temporal stops them. Under Kubernetes' default 30 s termination
 * grace, so a pod that sets none still exits before it is killed; a host
 * that knows its own longer grace sets it (the agent sandbox's manifest).
 */
export const DEFAULT_DRAIN_GRACE_MS = 25_000;

// Re-exported so the runner/manager options mappers default the lock-wait
// bound from the same constant the lock module owns (no drift across the
// three construction sites — mirrors DEFAULT_CURSOR_STREAM_STALL_TIMEOUT_MS).
export { DEFAULT_WORKSPACE_LOCK_TIMEOUT_MS } from "./shared/workspace/workspace-lock.js";
import { DEFAULT_WORKSPACE_LOCK_TIMEOUT_MS } from "./shared/workspace/workspace-lock.js";
// The same for the open-operation backstop, whose owner is the turn runtime.
export { DEFAULT_OPEN_OPERATION_MAX_MS } from "./harness/open-operations.js";
import { DEFAULT_OPEN_OPERATION_MAX_MS } from "./harness/open-operations.js";
// And the liveness interval, whose owner is the runtime's liveness pump.
export { DEFAULT_LIVENESS_INTERVAL_MS } from "./harness/liveness-pump.js";
import { DEFAULT_LIVENESS_INTERVAL_MS } from "./harness/liveness-pump.js";
// And the Stigmer harness's shell's timeout ceiling, which the shell's bounds own.
export { DEFAULT_SHELL_TIMEOUT_MAX_SECONDS } from "./shared/shell/limits.js";
import { DEFAULT_SHELL_TIMEOUT_MAX_SECONDS } from "./shared/shell/limits.js";
import { getRunnerSecret } from "./shared/runner-credential-store.js";
import { loadTemporalConnectionConfig } from "@stigmer/temporal-codecs";
import type { TemporalConnectionConfig } from "@stigmer/temporal-codecs";

/**
 * A shared mutable credential reference. The root that owns a credential
 * writes `current` on every rotation; every reader resolves it at the moment
 * of use, so one write reaches all of them (the per-request reads in
 * StigmerClient, the artifact store, the checkpoint saver and the agent
 * proxy's lanes). `Config` hands readers a `Readonly` view: rotation has one writer.
 */
export interface TokenRef {
  current: string | null;
}

export interface Config {
  readonly taskQueue: string;
  readonly temporalAddress: string;
  readonly temporalNamespace: string;
  /**
   * TLS, mutual TLS or an API key for the Temporal connection, read from
   * the `STIGMER_TEMPORAL_*` settings through the credential store (the
   * API key and the client key are in its custody list, so they never
   * stay in the environment agent tools inherit). `{}` is plaintext.
   */
  readonly temporalConnection: TemporalConnectionConfig;
  readonly stigmerBackendEndpoint: string;
  /**
   * The control-plane credential, read per use (the module header). The
   * static root and the manager both rotate it in place; `main.ts`'s
   * `loadConfig` result holds the boot capture the roots start from.
   */
  readonly stigmerTokenRef: Readonly<TokenRef>;
  /**
   * The MCP bridge endpoint for the runner-synthesized attachments —
   * memory, channel messaging and conversation participation
   * (STIGMER_MCP_BRIDGE_ENDPOINT, e.g. https://mcp.stigmer.ai). A root
   * that discovers its bootstrap fills an unset value from the server's
   * answer (bootstrap.ts; stigmer#1374), before the agent host starts.
   * Null selects the OSS/local shape: a spawned `stigmer mcp-server`
   * stdio child against the local backend. See
   * shared/memory-attachment.ts, shared/channel-attachment.ts and
   * shared/conversation-attachment.ts.
   */
  readonly mcpBridgeEndpoint: string | null;
  /**
   * The Stigmer server's public address (STIGMER_MCP_PUBLIC_ENDPOINT), which
   * the server hands every sandbox it provisions or an operator names to a
   * runner started by hand. When set, it fills a missing
   * STIGMER_SERVER_ADDRESS for any MCP server that declares the key; null
   * leaves a remote server's address unfilled. See
   * shared/platform-server-address.ts.
   */
  readonly mcpPublicEndpoint: string | null;
  readonly workspaceRootDir: string;
  /**
   * Execution location: where the agent runs and whose filesystem it sees.
   * "local" allows local-path workspaces (host filesystem); "cloud" runs in a
   * server-provisioned sandbox (git-only). Independent of {@link proxyEndpoint},
   * which controls credential/artifact transport — the desktop runner executes
   * locally yet still proxies its model traffic.
   */
  readonly mode: "local" | "cloud";
  readonly proxyEndpoint: string | null;
  readonly maxConcurrentActivities: number;
  readonly idleTimeoutSeconds: number | null;
  readonly checkpointerType: "memory" | "http" | "sqlite";
  readonly checkpointerProxyEndpoint: string | null;
  /**
   * Endpoint the proxy artifact store presigns against
   * (STIGMER_ARTIFACT_PROXY_ENDPOINT), defaulting to {@link proxyEndpoint} —
   * the checkpointer-override pattern (stigmer#803). Splitting the two lets
   * artifact traffic target the real control plane while LLM traffic goes
   * elsewhere (the conformance harness points LLM calls at a mock proxy that
   * serves no presign routes; embedders can route artifact storage
   * independently the same way).
   */
  readonly artifactProxyEndpoint: string | null;
  readonly primaryModel: string;
  /**
   * No-progress bound for every harness's engine stream (milliseconds).
   * `loadConfig` reads
   * CURSOR_STREAM_STALL_TIMEOUT_MS and both boot paths in `main.ts` forward
   * it; embedders set the `cursorStreamStallTimeoutMs` option. If the engine
   * reports no activity for this long while no operation is open, the turn
   * runtime's stall watchdog (harness/run-turn.ts over
   * shared/stall-watchdog.ts) cancels the run and fails the execution with a
   * StallTimeoutError rather than hanging at RUN_IN_PROGRESS forever. An
   * open operation holds it (`harness/open-operations.ts`), so a silent
   * build is not a stall.
   *
   * This bounds no-progress time only; it is orthogonal to Temporal's
   * heartbeatTimeout (process liveness) and the turn's keep-alive heartbeat
   * (`shared/heartbeat.ts` CANCELLATION_PULSE_MS).
   */
  readonly cursorStreamStallTimeoutMs: number;
  /**
   * The runtime's backstop for one open operation (milliseconds,
   * STIGMER_OPEN_OPERATION_MAX_MS, the `openOperationMaxMs` option): see
   * `harness/open-operations.ts`. Read by the turn runtime, in the runner's
   * own process, and by the Claude adapter in the agent host, as every
   * served MCP server's per-call timeout (`execute-claude/loopback-mcp.ts`).
   */
  readonly openOperationMaxMs: number;
  /**
   * How often a working turn says what it has open (milliseconds,
   * STIGMER_LIVENESS_INTERVAL_MS, the `livenessIntervalMs` option): the
   * runtime sends a `stigmer.run.liveness` preview at this interval while
   * the turn runs, and at once when its open operations change
   * (`harness/liveness-pump.ts`). Read by the turn runtime only.
   */
  readonly livenessIntervalMs: number;
  /**
   * The most the model may raise one command's timeout to in the Stigmer
   * harness's shell (seconds, STIGMER_SHELL_TIMEOUT_MAX_SECONDS, the
   * `shellTimeoutMaxSeconds` option); a larger request is clamped and the
   * result says so
   * (`activities/execute-deep-agent/shell-tool.ts`). Crosses to the agent
   * host, where the shell runs.
   */
  readonly shellTimeoutMaxSeconds: number;
  /**
   * Whether the model may start a command in the background on the Stigmer
   * harness's shell (STIGMER_SHELL_BACKGROUND_ENABLED, the
   * `shellBackgroundEnabled` option; on by default). Off, `execute` is
   * declared without `background`, no `stop_background_command` is bound,
   * and no round-end wait is installed
   * (`turn-setup.ts`): every command runs in the foreground, so a turn never
   * waits on one and a sandbox never stays awake for one. Crosses to the
   * agent host, where the shell runs.
   */
  readonly shellBackgroundEnabled: boolean;
  /**
   * Max wait (milliseconds) for the per-workspace turn lock before failing
   * the execution with a "workspace is in use by another session" error.
   * See shared/workspace/workspace-lock.ts for the serialization model.
   */
  readonly workspaceLockTimeoutMs: number;
  /**
   * How long the worker's shutdown waits for in-flight turns (milliseconds,
   * STIGMER_DRAIN_GRACE_MS, the `drainGraceMs` option; Temporal's
   * `shutdownGraceTime`): each turn yields at its engine's next durable step
   * boundary and continues on the next runner, so a step running when the
   * drain began finishes instead of being cut and repeated (stigmer#2428).
   * Past it Temporal stops the turn mid-step, which continues too. Static
   * mode only: the desktop manager exits at once by design (issue #177).
   * See {@link DEFAULT_DRAIN_GRACE_MS}.
   */
  readonly drainGraceMs: number;
  /**
   * Shared reference to the runner credential (the roots bind it): the
   * server-minted runner token once adopted, tracking the control-plane token
   * in lockstep before that. StigmerClient authenticates value fetches with
   * it so the server's runner-class gate recognizes a desktop runner (see
   * stigmer-client.ts).
   */
  readonly stigmerRunnerTokenRef?: Readonly<TokenRef>;
}

export function loadConfig(): Config {
  const mode = (process.env.MODE ?? "local") as "local" | "cloud";
  const proxyEndpoint = process.env.STIGMER_PROXY_ENDPOINT ?? null;
  const proxyActive = !!proxyEndpoint;

  const taskQueue = process.env.STIGMER_TASK_QUEUE
    ?? process.env.TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE
    ?? "stigmer_runner";

  // Temporal address is no longer required up front. When unset, the runner
  // self-discovers it from the control plane during boot (see bootstrap.ts):
  // an explicit value always wins, a token triggers discovery, and a tokenless
  // local runner falls back to localhost. An empty string here means "resolve
  // later" — the factory fills it in before connecting to Temporal.
  const temporalAddress = process.env.TEMPORAL_SERVICE_ADDRESS ?? "";

  const temporalNamespace = process.env.TEMPORAL_NAMESPACE ?? "default";

  const stigmerBackendEndpoint = normalizeEndpoint(
    mode === "local"
      ? (process.env.STIGMER_BACKEND_ENDPOINT ?? "http://localhost:7234")
      : requireEnv("STIGMER_BACKEND_ENDPOINT"),
  );

  // Secrets resolve through the credential store, not process.env — the
  // boot capture has already moved them out of the environment (#508). The
  // ref holds the boot capture: this function is read once, by main.ts, and
  // the root it feeds builds the live ref from the value (the module header).
  const stigmerTokenValue = getRunnerSecret("STIGMER_TOKEN");
  if ((mode === "cloud" || proxyActive) && !stigmerTokenValue) {
    throw new Error("Required environment variable STIGMER_TOKEN is not set");
  }
  const stigmerTokenRef: TokenRef = { current: stigmerTokenValue ?? null };

  const mcpBridgeEndpoint = process.env.STIGMER_MCP_BRIDGE_ENDPOINT ?? null;
  const mcpPublicEndpoint = process.env.STIGMER_MCP_PUBLIC_ENDPOINT || null;

  const workspaceRootDir = resolveWorkspaceRootDir();

  const maxConcurrentActivities = parseInt(
    process.env.TEMPORAL_MAX_CONCURRENCY ?? "5",
    10,
  );

  const idleTimeoutRaw = process.env.STIGMER_IDLE_TIMEOUT_SECONDS;
  const idleTimeoutSeconds = idleTimeoutRaw ? parseInt(idleTimeoutRaw, 10) : null;

  // Local/OSS default is the durable SQLite saver so HITL/pause/transient-recovery
  // resume across ExecuteDeepAgent invocations (stigmer/stigmer#204); cloud stays
  // on the proxy-backed http saver. STIGMER_CHECKPOINTER_TYPE overrides explicitly
  // (e.g. "memory" for ephemeral test runs).
  const checkpointerType =
    (process.env.STIGMER_CHECKPOINTER_TYPE as "memory" | "http" | "sqlite" | undefined)
    ?? (mode === "cloud" ? "http" : "sqlite");
  const checkpointerProxyEndpoint = process.env.STIGMER_CHECKPOINTER_PROXY_ENDPOINT
    ?? proxyEndpoint;
  const artifactProxyEndpoint = process.env.STIGMER_ARTIFACT_PROXY_ENDPOINT
    ?? proxyEndpoint;

  const primaryModel = process.env.STIGMER_PRIMARY_MODEL ?? "gpt-4.1";

  const cursorStreamStallTimeoutMs = process.env.CURSOR_STREAM_STALL_TIMEOUT_MS
    ? parseInt(process.env.CURSOR_STREAM_STALL_TIMEOUT_MS, 10)
    : DEFAULT_CURSOR_STREAM_STALL_TIMEOUT_MS;

  const openOperationMaxMs = process.env.STIGMER_OPEN_OPERATION_MAX_MS
    ? parseInt(process.env.STIGMER_OPEN_OPERATION_MAX_MS, 10)
    : DEFAULT_OPEN_OPERATION_MAX_MS;

  const livenessIntervalMs = parseLivenessIntervalMs(process.env.STIGMER_LIVENESS_INTERVAL_MS);

  const shellTimeoutMaxSeconds = process.env.STIGMER_SHELL_TIMEOUT_MAX_SECONDS
    ? parseInt(process.env.STIGMER_SHELL_TIMEOUT_MAX_SECONDS, 10)
    : DEFAULT_SHELL_TIMEOUT_MAX_SECONDS;

  const shellBackgroundEnabled = parseShellBackgroundEnabled(process.env.STIGMER_SHELL_BACKGROUND_ENABLED);

  const workspaceLockTimeoutMs = process.env.WORKSPACE_LOCK_TIMEOUT_MS
    ? parseInt(process.env.WORKSPACE_LOCK_TIMEOUT_MS, 10)
    : DEFAULT_WORKSPACE_LOCK_TIMEOUT_MS;

  const drainGraceMs = process.env.STIGMER_DRAIN_GRACE_MS
    ? parseInt(process.env.STIGMER_DRAIN_GRACE_MS, 10)
    : DEFAULT_DRAIN_GRACE_MS;

  return {
    taskQueue,
    temporalAddress,
    temporalNamespace,
    temporalConnection: loadTemporalConnectionConfig(getRunnerSecret),
    stigmerBackendEndpoint,
    stigmerTokenRef,
    mcpBridgeEndpoint,
    mcpPublicEndpoint,
    workspaceRootDir,
    mode,
    proxyEndpoint,
    maxConcurrentActivities,
    idleTimeoutSeconds,
    checkpointerType,
    checkpointerProxyEndpoint,
    artifactProxyEndpoint,
    primaryModel,
    cursorStreamStallTimeoutMs,
    openOperationMaxMs,
    livenessIntervalMs,
    shellTimeoutMaxSeconds,
    shellBackgroundEnabled,
    workspaceLockTimeoutMs,
    drainGraceMs,
  };
}

/** The bounds `STIGMER_LIVENESS_INTERVAL_MS` must fall in: at least a second, and under the console's 60 s slow watch. */
export const LIVENESS_INTERVAL_BOUNDS_MS = { min: 1_000, below: 60_000 } as const;

/**
 * `STIGMER_LIVENESS_INTERVAL_MS`, or the default when it is unset. A value
 * that is not a whole number of milliseconds, or falls outside
 * {@link LIVENESS_INTERVAL_BOUNDS_MS}, falls back to the default with a
 * warning: under a second floods the session's watchers, and at a minute or
 * more a watcher's slow hint fires between two previews of a working turn.
 */
function parseLivenessIntervalMs(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_LIVENESS_INTERVAL_MS;
  const parsed = Number(raw);
  const { min, below } = LIVENESS_INTERVAL_BOUNDS_MS;
  if (!Number.isInteger(parsed) || parsed < min || parsed >= below) {
    console.warn(
      `STIGMER_LIVENESS_INTERVAL_MS=${JSON.stringify(raw)} is not a whole number of milliseconds from ${min} to under ${below}; ` +
        `using the default ${DEFAULT_LIVENESS_INTERVAL_MS}`,
    );
    return DEFAULT_LIVENESS_INTERVAL_MS;
  }
  return parsed;
}

/**
 * `STIGMER_SHELL_BACKGROUND_ENABLED`: `false` turns background commands off,
 * `true` or unset leaves them on. Any other value keeps them on with a
 * warning, as a malformed liveness interval keeps its default: a typo must
 * not quietly take a capability away.
 */
function parseShellBackgroundEnabled(raw: string | undefined): boolean {
  if (raw === undefined || raw === "" || raw === "true") return true;
  if (raw === "false") return false;
  console.warn(`STIGMER_SHELL_BACKGROUND_ENABLED=${JSON.stringify(raw)} is neither "true" nor "false"; background commands stay on`);
  return true;
}

function resolveWorkspaceRootDir(): string {
  const explicit = process.env.WORKSPACE_ROOT_DIR;
  if (explicit) {
    return explicit;
  }

  console.warn(
    "WORKSPACE_ROOT_DIR is not set — creating isolated fallback workspace. " +
    "This likely means the runner was started outside the CLI daemon.",
  );

  const fallbackDir = safeWorkspaceFallback();
  mkdirSync(fallbackDir, { recursive: true });
  return fallbackDir;
}

function safeWorkspaceFallback(): string {
  try {
    return join(homedir(), ".stigmer", "workspaces", "runner");
  } catch {
    return join(tmpdir(), "stigmer-runner-workspace");
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

/**
 * Ensures the endpoint has an HTTP(S) scheme. Port 443 implies TLS;
 * all other bare host:port endpoints get http://.
 *
 * Exported so registry-endpoint.ts applies the same normalization to
 * STIGMER_BACKEND_ENDPOINT that this module applies when loading config.
 */
export function normalizeEndpoint(endpoint: string): string {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return endpoint;
  }
  if (endpoint.endsWith(":443")) {
    return `https://${endpoint}`;
  }
  return `http://${endpoint}`;
}

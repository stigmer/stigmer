/**
 * Environment-based configuration for the cursor-runner service.
 *
 * Mirrors the Python agent-runner's Config.load_from_env() pattern.
 * All values come from environment variables set by the CLI daemon
 * or Kubernetes pod spec.
 *
 * Two credential modes:
 *
 * 1. Direct mode (local / OSS):
 *    - CURSOR_API_KEY provided directly by the user.
 *    - STIGMER_TOKEN is optional (local stigmer-server has no auth).
 *    - STIGMER_PROXY_ENDPOINT is NOT set.
 *
 * 2. Proxy mode (cloud / managed runners):
 *    - STIGMER_PROXY_ENDPOINT + STIGMER_TOKEN are required.
 *    - CURSOR_API_KEY is NOT required -- the proxy injects it.
 *    - The fetch interceptor (proxy/fetch-interceptor.ts) rewrites
 *      outbound Cursor SDK requests to route through the proxy.
 *    - Runner is credential-free: it only holds STIGMER_TOKEN.
 *
 * Proxy mode is activated when STIGMER_PROXY_ENDPOINT is set, regardless
 * of MODE. This allows testing the proxy locally.
 *
 * Workspace isolation:
 *
 * WORKSPACE_ROOT_DIR must always resolve to a directory that is NOT the
 * runner's own app directory. Falling back to process.cwd() would expose
 * runner internals (dist/, node_modules, data/) to the Cursor agent. The
 * fallback creates an isolated directory under ~/.stigmer/workspaces/.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

/**
 * Suffix appended to the runner's base task queue to form the cursor-specific
 * activity queue. The Go/Java workflow applies the same suffix when dispatching
 * ExecuteCursor activities, ensuring deterministic routing to this worker.
 */
export const CURSOR_QUEUE_SUFFIX = ":cursor";

export interface Config {
  readonly taskQueue: string;
  readonly temporalAddress: string;
  readonly temporalNamespace: string;
  readonly stigmerBackendEndpoint: string;
  readonly stigmerToken: string | null;
  readonly cursorApiKey: string;
  readonly workspaceRootDir: string;
  readonly mode: "local" | "cloud";
  readonly proxyEndpoint: string | null;
  readonly maxConcurrentActivities: number;
  readonly idleTimeoutSeconds: number | null;
  readonly cloudModeEnabled: boolean;
}

export function loadConfig(): Config {
  const mode = (process.env.MODE ?? "local") as "local" | "cloud";
  const proxyEndpoint = process.env.STIGMER_PROXY_ENDPOINT ?? null;
  const proxyActive = !!proxyEndpoint;

  const taskQueue = process.env.STIGMER_TASK_QUEUE
    ?? process.env.TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE
    ?? "agent_execution_runner";

  const temporalAddress = mode === "local"
    ? (process.env.TEMPORAL_SERVICE_ADDRESS ?? "localhost:7233")
    : requireEnv("TEMPORAL_SERVICE_ADDRESS");

  const temporalNamespace = process.env.TEMPORAL_NAMESPACE ?? "default";

  const stigmerBackendEndpoint = normalizeEndpoint(
    mode === "local"
      ? (process.env.STIGMER_BACKEND_ENDPOINT ?? "http://localhost:7234")
      : requireEnv("STIGMER_BACKEND_ENDPOINT"),
  );

  const stigmerToken = (mode === "cloud" || proxyActive)
    ? requireEnv("STIGMER_TOKEN")
    : (process.env.STIGMER_TOKEN ?? null);

  // In proxy mode the Cursor API key lives on the proxy, not the runner.
  // The runner passes STIGMER_TOKEN to the proxy; the proxy injects the
  // real CURSOR_API_KEY on outbound requests to Cursor.
  const cursorApiKey = proxyActive
    ? (process.env.CURSOR_API_KEY ?? "proxy-managed")
    : requireEnv("CURSOR_API_KEY");

  const workspaceRootDir = resolveWorkspaceRootDir();

  const maxConcurrentActivities = parseInt(
    process.env.TEMPORAL_MAX_CONCURRENCY ?? "5",
    10,
  );

  const idleTimeoutRaw = process.env.STIGMER_IDLE_TIMEOUT_SECONDS;
  const idleTimeoutSeconds = idleTimeoutRaw ? parseInt(idleTimeoutRaw, 10) : null;

  return {
    taskQueue,
    temporalAddress,
    temporalNamespace,
    stigmerBackendEndpoint,
    stigmerToken,
    cursorApiKey,
    workspaceRootDir,
    mode,
    proxyEndpoint,
    maxConcurrentActivities,
    idleTimeoutSeconds,
    cloudModeEnabled: process.env.STIGMER_CURSOR_CLOUD_MODE_ENABLED === "true",
  };
}

/**
 * Resolves the workspace root directory, ensuring it is never the runner's
 * own app directory. Falls back to an isolated directory under
 * ~/.stigmer/workspaces/cursor-runner/ instead of process.cwd().
 */
function resolveWorkspaceRootDir(): string {
  const explicit = process.env.WORKSPACE_ROOT_DIR;
  if (explicit) {
    return explicit;
  }

  console.warn(
    "WORKSPACE_ROOT_DIR is not set — creating isolated fallback workspace. " +
    "This likely means the cursor-runner was started outside the CLI daemon.",
  );

  const fallbackDir = safeWorkspaceFallback();
  mkdirSync(fallbackDir, { recursive: true });
  return fallbackDir;
}

/**
 * Returns a safe, isolated directory path that cannot overlap with the
 * runner's app directory. Prefers ~/.stigmer/workspaces/cursor-runner/;
 * falls back to a tmpdir-based path if the home directory is unavailable.
 */
function safeWorkspaceFallback(): string {
  try {
    return join(homedir(), ".stigmer", "workspaces", "cursor-runner");
  } catch {
    return join(tmpdir(), "stigmer-cursor-workspace");
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
 * Ensures the endpoint has an HTTP(S) scheme. The daemon passes raw
 * host:port for the Python agent-runner (gRPC); cursor-runner uses
 * Connect-ES (HTTP transport) and needs the scheme prefix.
 *
 * Port 443 implies TLS, so bare host:443 endpoints get https://.
 * All other bare host:port endpoints get http:// (safe for local dev).
 */
function normalizeEndpoint(endpoint: string): string {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return endpoint;
  }
  if (endpoint.endsWith(":443")) {
    return `https://${endpoint}`;
  }
  return `http://${endpoint}`;
}

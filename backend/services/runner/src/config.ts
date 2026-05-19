/**
 * Environment-based configuration for the unified runner service.
 *
 * Supports both ExecuteCursor and ExecuteDeepAgent activities from a single
 * process. All values come from environment variables set by the CLI daemon,
 * Kubernetes pod spec, or Daytona sandbox launcher.
 *
 * Credential modes:
 *
 * 1. Direct mode (local / OSS):
 *    - CURSOR_API_KEY provided directly by the user (for Cursor harness).
 *    - STIGMER_TOKEN is optional (local stigmer-server has no auth).
 *    - STIGMER_PROXY_ENDPOINT is NOT set.
 *
 * 2. Proxy mode (cloud / managed runners):
 *    - STIGMER_PROXY_ENDPOINT + STIGMER_TOKEN are required.
 *    - CURSOR_API_KEY is NOT required — the proxy injects it.
 *    - The fetch interceptor rewrites outbound Cursor SDK requests.
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
  readonly runnerId: string | null;
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

  const cursorApiKey = proxyActive
    ? (process.env.CURSOR_API_KEY ?? "proxy-managed")
    : (process.env.CURSOR_API_KEY ?? "");

  const workspaceRootDir = resolveWorkspaceRootDir();

  const maxConcurrentActivities = parseInt(
    process.env.TEMPORAL_MAX_CONCURRENCY ?? "5",
    10,
  );

  const idleTimeoutRaw = process.env.STIGMER_IDLE_TIMEOUT_SECONDS;
  const idleTimeoutSeconds = idleTimeoutRaw ? parseInt(idleTimeoutRaw, 10) : null;

  const runnerId = process.env.STIGMER_RUNNER_ID ?? null;

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
    runnerId,
  };
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

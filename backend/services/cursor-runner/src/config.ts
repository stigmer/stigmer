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
 */

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

  const workspaceRootDir = process.env.WORKSPACE_ROOT_DIR ?? process.cwd();

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
  };
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
 */
function normalizeEndpoint(endpoint: string): string {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return endpoint;
  }
  return `http://${endpoint}`;
}

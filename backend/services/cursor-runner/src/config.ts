/**
 * Environment-based configuration for the cursor-runner service.
 *
 * Mirrors the Python agent-runner's Config.load_from_env() pattern.
 * All values come from environment variables set by the CLI daemon
 * or Kubernetes pod spec.
 */

export interface Config {
  readonly taskQueue: string;
  readonly temporalAddress: string;
  readonly temporalNamespace: string;
  readonly stigmerBackendEndpoint: string;
  readonly stigmerToken: string;
  readonly cursorApiKey: string;
  readonly workspaceRootDir: string;
  readonly mode: "local" | "cloud";
  readonly maxConcurrentActivities: number;
  readonly idleTimeoutSeconds: number | null;
}

export function loadConfig(): Config {
  const mode = (process.env.MODE ?? "local") as "local" | "cloud";

  const taskQueue = process.env.STIGMER_TASK_QUEUE
    ?? process.env.TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE
    ?? "agent_execution_runner";

  const temporalAddress = mode === "local"
    ? (process.env.TEMPORAL_SERVICE_ADDRESS ?? "localhost:7233")
    : requireEnv("TEMPORAL_SERVICE_ADDRESS");

  const temporalNamespace = process.env.TEMPORAL_NAMESPACE ?? "default";

  const stigmerBackendEndpoint = mode === "local"
    ? (process.env.STIGMER_BACKEND_ENDPOINT ?? "http://localhost:7234")
    : requireEnv("STIGMER_BACKEND_ENDPOINT");

  const stigmerToken = requireEnv("STIGMER_TOKEN");
  const cursorApiKey = requireEnv("CURSOR_API_KEY");

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

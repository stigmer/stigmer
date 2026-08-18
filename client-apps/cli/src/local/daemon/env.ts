// The foreground launcher hands the supervised daemon everything it needs to
// run through the environment. Centralizing the variable names and the
// (de)serialization here keeps that contract in one place: the launcher writes
// it with buildDaemonEnv, the daemon reads it with readDaemonConfig, and
// nothing in between guesses at string keys.

/** Environment variable names that make up the launcher -> daemon contract. */
export const DaemonEnvVar = {
  DataDir: "STIGMER_DATA_DIR",
  LogDir: "STIGMER_LOG_DIR",
  TemporalManaged: "STIGMER_TEMPORAL_MANAGED",
  TemporalAddress: "TEMPORAL_SERVICE_ADDRESS",
  ServerOnly: "STIGMER_SERVER_ONLY",
  NoWeb: "STIGMER_NO_WEB",
  ServerBin: "STIGMER_SERVER_BIN",
  RunnerNodeBin: "STIGMER_RUNNER_NODE_BIN",
  RunnerEntry: "STIGMER_RUNNER_ENTRY",
  RunnerAppDir: "STIGMER_RUNNER_APP_DIR",
  CursorApiKey: "CURSOR_API_KEY",
  AnthropicApiKey: "ANTHROPIC_API_KEY",
  ActivityRouting: "STIGMER_ACTIVITY_ROUTING",
  OperatorEmail: "STIGMER_OPERATOR_EMAIL",
  OperatorName: "STIGMER_OPERATOR_NAME",
} as const;

/** Resolved runner launch coordinates. */
export interface RunnerLaunch {
  nodeBin: string;
  entryPath: string;
  appDir: string;
}

/** The daemon's resolved configuration, parsed from the environment. */
export interface DaemonConfig {
  dataDir: string;
  logDir: string;
  temporalManaged: boolean;
  temporalAddress: string;
  serverOnly: boolean;
  noWeb: boolean;
  serverBin: string;
  runner?: RunnerLaunch;
  cursorApiKey?: string;
  anthropicApiKey?: string;
  activityRouting?: string;
  operatorEmail?: string;
  operatorName?: string;
}

/** Inputs the launcher already resolved, to encode into the daemon env. */
export interface DaemonEnvInputs {
  dataDir: string;
  logDir: string;
  temporalManaged: boolean;
  temporalAddress: string;
  serverOnly: boolean;
  noWeb: boolean;
  serverBin: string;
  runner?: RunnerLaunch;
  // Anthropic API key resolved by the launcher (env > config file). Must be
  // written into the daemon env explicitly: unlike a shell-exported key, a key
  // persisted by `stigmer setup` exists only in the config file and would
  // otherwise never reach the runner. Anthropic is the only provider with a
  // persisted delivery path — other keys (OPENAI_API_KEY, CURSOR_API_KEY)
  // reach the runner solely via shell-env inheritance.
  anthropicApiKey?: string;
  // Operator identity resolved by the launcher (env > config file), the same
  // persisted-delivery reasoning as the Anthropic key (oss#796). Consumed by
  // the SERVER child only — the runner resolves caller identity from the
  // session's stamped created_by, never from its own env.
  operatorEmail?: string;
  operatorName?: string;
}

/**
 * Build the environment for the internal-daemon child: the caller's environment
 * plus the resolved contract values. Runner coordinates are omitted in
 * server-only mode.
 */
export function buildDaemonEnv(inputs: DaemonEnvInputs, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  env[DaemonEnvVar.DataDir] = inputs.dataDir;
  env[DaemonEnvVar.LogDir] = inputs.logDir;
  env[DaemonEnvVar.TemporalManaged] = String(inputs.temporalManaged);
  env[DaemonEnvVar.TemporalAddress] = inputs.temporalAddress;
  env[DaemonEnvVar.ServerBin] = inputs.serverBin;
  if (inputs.serverOnly) env[DaemonEnvVar.ServerOnly] = "true";
  if (inputs.noWeb) env[DaemonEnvVar.NoWeb] = "1";
  if (inputs.runner !== undefined && !inputs.serverOnly) {
    env[DaemonEnvVar.RunnerNodeBin] = inputs.runner.nodeBin;
    env[DaemonEnvVar.RunnerEntry] = inputs.runner.entryPath;
    env[DaemonEnvVar.RunnerAppDir] = inputs.runner.appDir;
  }
  if (inputs.anthropicApiKey !== undefined) env[DaemonEnvVar.AnthropicApiKey] = inputs.anthropicApiKey;
  if (inputs.operatorEmail !== undefined) env[DaemonEnvVar.OperatorEmail] = inputs.operatorEmail;
  if (inputs.operatorName !== undefined) env[DaemonEnvVar.OperatorName] = inputs.operatorName;
  return env;
}

/** Parse the daemon configuration from an environment. Throws if a required
 * value is missing. */
export function readDaemonConfig(env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  const dataDir = required(env, DaemonEnvVar.DataDir);
  const logDir = env[DaemonEnvVar.LogDir] ?? `${dataDir}/logs`;
  const serverOnly = env[DaemonEnvVar.ServerOnly] === "true";

  const runner = readRunner(env);
  return {
    dataDir,
    logDir,
    temporalManaged: env[DaemonEnvVar.TemporalManaged] === "true",
    temporalAddress: env[DaemonEnvVar.TemporalAddress] ?? "127.0.0.1:7233",
    serverOnly,
    noWeb: env[DaemonEnvVar.NoWeb] === "1",
    serverBin: required(env, DaemonEnvVar.ServerBin),
    runner: serverOnly ? undefined : runner,
    cursorApiKey: nonEmpty(env[DaemonEnvVar.CursorApiKey]),
    anthropicApiKey: nonEmpty(env[DaemonEnvVar.AnthropicApiKey]),
    activityRouting: nonEmpty(env[DaemonEnvVar.ActivityRouting]),
    operatorEmail: nonEmpty(env[DaemonEnvVar.OperatorEmail]),
    operatorName: nonEmpty(env[DaemonEnvVar.OperatorName]),
  };
}

function readRunner(env: NodeJS.ProcessEnv): RunnerLaunch | undefined {
  const nodeBin = env[DaemonEnvVar.RunnerNodeBin];
  const entryPath = env[DaemonEnvVar.RunnerEntry];
  const appDir = env[DaemonEnvVar.RunnerAppDir];
  if (!nodeBin || !entryPath || !appDir) return undefined;
  return { nodeBin, entryPath, appDir };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new Error(`${key} is required for the daemon process`);
  }
  return value;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== "" ? value : undefined;
}

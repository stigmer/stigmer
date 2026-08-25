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
  ServerNodeBin: "STIGMER_SERVER_NODE_BIN",
  ServerEntry: "STIGMER_SERVER_ENTRY",
  ServerAppDir: "STIGMER_SERVER_APP_DIR",
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

/**
 * Resolved server launch coordinates — a modeled state, not an inference
 * (D4 #24). "node" is the TypeScript server (the served implementation
 * since the DD-006 cutover): a node binary + bundled entry, the runner's
 * launch shape. "binary" is the Go stigmer-server executable — the
 * rollback path, selected by the STIGMER_SERVER_BIN override.
 */
export type ServerLaunch =
  | { kind: "binary"; bin: string }
  | { kind: "node"; nodeBin: string; entryPath: string; appDir: string };

/** The daemon's resolved configuration, parsed from the environment. */
export interface DaemonConfig {
  dataDir: string;
  logDir: string;
  temporalManaged: boolean;
  temporalAddress: string;
  serverOnly: boolean;
  noWeb: boolean;
  server: ServerLaunch;
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
  server: ServerLaunch;
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
  if (inputs.server.kind === "binary") {
    env[DaemonEnvVar.ServerBin] = inputs.server.bin;
    // Symmetric scrub: a stale node triple inherited from the caller's shell
    // must not ride the base spread into the children's environments.
    delete env[DaemonEnvVar.ServerNodeBin];
    delete env[DaemonEnvVar.ServerEntry];
    delete env[DaemonEnvVar.ServerAppDir];
  } else {
    env[DaemonEnvVar.ServerNodeBin] = inputs.server.nodeBin;
    env[DaemonEnvVar.ServerEntry] = inputs.server.entryPath;
    env[DaemonEnvVar.ServerAppDir] = inputs.server.appDir;
    // A caller-exported STIGMER_SERVER_BIN must not leak through the base
    // spread when the launcher resolved the node shape — the daemon prefers
    // the binary override precisely because setting it means "run the Go
    // server", and the launcher already honored that upstream.
    delete env[DaemonEnvVar.ServerBin];
  }
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
    server: readServer(env),
    runner: serverOnly ? undefined : runner,
    cursorApiKey: nonEmpty(env[DaemonEnvVar.CursorApiKey]),
    anthropicApiKey: nonEmpty(env[DaemonEnvVar.AnthropicApiKey]),
    activityRouting: nonEmpty(env[DaemonEnvVar.ActivityRouting]),
    operatorEmail: nonEmpty(env[DaemonEnvVar.OperatorEmail]),
    operatorName: nonEmpty(env[DaemonEnvVar.OperatorName]),
  };
}

// The binary override wins when both shapes are present: STIGMER_SERVER_BIN
// is the no-code-change rollback lever (D2 §6), and buildDaemonEnv never
// writes both, so a both-present env means an operator override.
function readServer(env: NodeJS.ProcessEnv): ServerLaunch {
  const bin = env[DaemonEnvVar.ServerBin];
  if (bin !== undefined && bin !== "") {
    return { kind: "binary", bin };
  }
  const nodeBin = env[DaemonEnvVar.ServerNodeBin];
  const entryPath = env[DaemonEnvVar.ServerEntry];
  const appDir = env[DaemonEnvVar.ServerAppDir];
  if (!nodeBin || !entryPath || !appDir) {
    throw new Error(
      `${DaemonEnvVar.ServerBin} or the ${DaemonEnvVar.ServerNodeBin}/${DaemonEnvVar.ServerEntry}/${DaemonEnvVar.ServerAppDir} triple is required for the daemon process`,
    );
  }
  return { kind: "node", nodeBin, entryPath, appDir };
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

// Foreground control of the daemon: `up` (spawn + verify + wait-ready),
// `down` (signal + wait + safety-net cleanup), and a liveness check.
//
// `up` resolves every heavy dependency in the foreground (Temporal binary,
// server launch, runner entry) so failures surface with a clear message before
// a detached daemon is spawned, then re-execs this same CLI as the hidden
// `internal-daemon` and waits until the server's gRPC port answers.

import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Config, load as loadConfig } from "../../config/config.js";
import { log } from "../../logger.js";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { ExitCode } from "../../errors/exit-codes.js";
import { DAEMON_PID_FILE, SERVER_PORT } from "../constants.js";
import { tcpConnects, waitForTcp } from "../net/tcp.js";
import { dataDir, logDir } from "../paths.js";
import { readPidFile, removePidFile } from "../state/pidfile.js";
import { findProcessByPort, isProcessAlive, killProcess } from "../state/proc.js";
import { type StartupConfig, removeStartupConfig, saveStartupConfig } from "../state/startup-config.js";
import { rotateLogs } from "../state/log-rotation.js";
import { resolveApiKey, resolveProvider } from "../llm-config.js";
import { resolveOperatorIdentity } from "../operator-config.js";
import { ensureRunner } from "../runtime/runner.js";
import { ensureServer } from "../runtime/server-ts.js";
import { TemporalManager } from "../temporal/manager.js";
import { buildDaemonEnv, type DaemonEnvInputs } from "./env.js";

/** How long `up` waits for the server's gRPC port after spawning the daemon. */
const READY_TIMEOUT_MS = 60_000;
/** How long to wait for the daemon to come up before checking it is still alive. */
const DAEMON_SETTLE_MS = 3_000;
/** How long `down` waits for graceful daemon exit before force-killing. */
const STOP_TIMEOUT_MS = 15_000;
const STOP_POLL_MS = 500;

export interface UpOptions {
  serverOnly?: boolean;
  noWeb?: boolean;
}

/** Start the local stack in the background. Throws on any startup failure. */
export async function up(options: UpOptions = {}, home: string = homedir()): Promise<void> {
  const data = dataDir(home);
  const logs = logDir(home);

  cleanupOrphans(data);
  if (await isRunning(home)) {
    throw new CliExitError("daemon is already running", ExitCode.General);
  }

  mkdirSync(data, { recursive: true });
  mkdirSync(logs, { recursive: true });
  rotateLogs(logs);

  const config = loadConfig();
  const temporalManaged = isTemporalManaged(config);
  const temporal = TemporalManager.forHome(home);

  if (temporalManaged) {
    log.info("ensuring Temporal is installed");
    await temporal.ensureInstalled();
  }

  // THE cutover switch (D4 #24): resolves the TS server (repo tree or the
  // acquired @stigmer/server-slim), or the Go binary when STIGMER_SERVER_BIN
  // is set — the rollback lever.
  const server = ensureServer({ home });
  const runner = options.serverOnly === true ? undefined : ensureRunner({ home });

  const env = buildDaemonEnv(
    {
      dataDir: data,
      logDir: logs,
      temporalManaged,
      temporalAddress: temporal.address,
      serverOnly: options.serverOnly === true,
      noWeb: options.noWeb === true,
      server,
      runner,
      ...resolveLlmKeyInputs(config),
      ...resolveOperatorIdentityInputs(config),
    },
    process.env,
  );

  const daemonPid = spawnDaemon(env, join(logs, "daemon.log"));
  log.info("daemon process started", { pid: daemonPid });

  await sleep(DAEMON_SETTLE_MS);
  if (!isProcessAlive(daemonPid)) {
    throw new CliExitError("daemon process crashed during startup", ExitCode.General, [
      `Check ${join(logs, "daemon.log")} for details.`,
    ]);
  }

  await waitForTcp({ port: SERVER_PORT, timeoutMs: READY_TIMEOUT_MS, label: "stigmer-server" });

  await applySeedpackBestEffort(home);

  saveStartupConfig(data, buildStartupConfig(data, logs, temporal.address, daemonPid, options));
}

/**
 * Bootstrap the system seedpack into the freshly-started local backend.
 * Idempotent via a content-hash marker, so repeated `up`s are cheap. Best-effort: the stack is
 * already serving by this point, so a seedpack failure is surfaced as a warning
 * with a retry hint rather than tearing the stack down.
 */
async function applySeedpackBestEffort(home: string): Promise<void> {
  try {
    const [{ createBackendClient }, { getDefault }, { applySeedpack }] = await Promise.all([
      import("../../client/index.js"),
      import("../../config/config.js"),
      import("../seedpack/apply.js"),
    ]);
    // Always seed the local server `up` just started — never the active backend
    // context. A user whose CLI is pointed at cloud must still get their local
    // stack seeded, and must never have system resources applied to their cloud
    // org. Pin to a fresh local config (localhost:SERVER_PORT) with no auth.
    const client = createBackendClient({ config: getDefault(), getAccessToken: () => null });
    const result = await applySeedpack(
      {
        controller: client.controller,
        stigmer: client.stigmer,
        info: (line) => process.stderr.write(`${line}\n`),
        warn: (line) => process.stderr.write(`${line}\n`),
      },
      { markerDir: dataDir(home), home },
    );
    log.debug("seedpack bootstrap complete", { applied: result.applied, hash: result.hash, org: result.org });
  } catch (err) {
    log.warn("seedpack bootstrap failed", { error: String(err) });
    process.stderr.write(
      "Warning: failed to apply system resources (seedpack). Run 'stigmer seedpack apply' to retry.\n",
    );
  }
}

/** Stop the local stack. Returns false if nothing was running. */
export async function down(home: string = homedir()): Promise<boolean> {
  const data = dataDir(home);
  let pid = readPidFile(join(data, DAEMON_PID_FILE));
  if (pid === null) pid = findProcessByPort(SERVER_PORT);

  if (pid === null || !isProcessAlive(pid)) {
    removePidFile(join(data, DAEMON_PID_FILE));
    await stopManagedTemporal(home);
    cleanupOrphans(data);
    return false;
  }

  // The daemon traps SIGTERM and tears down children + Temporal in order.
  killProcess(pid, "SIGTERM");
  log.info("sent SIGTERM to daemon", { pid });

  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      removePidFile(join(data, DAEMON_PID_FILE));
      removeStartupConfig(data);
      return true;
    }
    await sleep(STOP_POLL_MS);
  }

  log.warn("daemon did not stop gracefully, force killing", { pid });
  killProcess(pid, "SIGKILL");
  removePidFile(join(data, DAEMON_PID_FILE));
  removeStartupConfig(data);
  await stopManagedTemporal(home);
  cleanupOrphans(data);
  return true;
}

/** Whether the daemon is running: live PID, else a server-port fallback. */
export async function isRunning(home: string = homedir()): Promise<boolean> {
  const data = dataDir(home);
  const pid = readPidFile(join(data, DAEMON_PID_FILE));
  if (pid !== null) {
    if (isProcessAlive(pid)) return true;
    removePidFile(join(data, DAEMON_PID_FILE)); // stale
  }
  return tcpConnects(SERVER_PORT, "127.0.0.1", 1000);
}

// Re-exec this CLI as the detached internal-daemon, returning its PID. Replaying
// execArgv carries the tsx loader in dev and is a no-op for a plain-node build.
function spawnDaemon(env: NodeJS.ProcessEnv, daemonLog: string): number {
  const script = process.argv[1];
  if (script === undefined) {
    throw new CliExitError("cannot resolve the CLI entry point to launch the daemon", ExitCode.General);
  }
  const out = openSync(daemonLog, "a");
  const child = spawn(process.execPath, [...process.execArgv, script, "internal-daemon"], {
    detached: true,
    env,
    stdio: ["ignore", out, out],
  });
  child.unref();
  if (child.pid === undefined) {
    throw new CliExitError("failed to start the daemon process", ExitCode.General);
  }
  return child.pid;
}

// Kill any daemon/server/runner left alive by a previous, improperly-stopped run.
function cleanupOrphans(data: string): void {
  for (const name of [DAEMON_PID_FILE, "stigmer-server.pid", "runner.pid"]) {
    const pidPath = join(data, name);
    const pid = readPidFile(pidPath);
    if (pid === null) continue;
    if (isProcessAlive(pid)) {
      log.warn("killing orphaned process from a previous run", { file: name, pid });
      killProcess(pid, "SIGTERM");
    }
    removePidFile(pidPath);
  }
}

async function stopManagedTemporal(home: string): Promise<void> {
  try {
    await TemporalManager.forHome(home).stop();
  } catch (err) {
    log.debug("managed Temporal stop skipped", { error: String(err) });
  }
}

// LLM-key delivery for the runner: a key persisted by `stigmer setup` lives only in
// the config file, so the launcher must write it into the daemon contract explicitly
// — unlike a shell-exported key, it cannot flow by env inheritance. resolveApiKey's
// precedence (env var > config file) makes both cases one code path; when the env
// var is set this re-writes the same value. Anthropic is the only provider the
// local stack executes on, so it is the only key with a persisted delivery path.
function resolveLlmKeyInputs(config: Config): Pick<DaemonEnvInputs, "anthropicApiKey"> {
  if (resolveProvider(config) !== "anthropic") return {};
  const key = resolveApiKey(config);
  return key === "" ? {} : { anthropicApiKey: key };
}

// Operator-identity delivery for the server child (oss#796): same persisted-
// delivery reasoning as the LLM key above — a setup-persisted identity lives
// only in the config file, so the launcher must write it into the daemon
// contract explicitly. resolveOperatorIdentity's precedence (env > config,
// sources never mixed) makes both cases one code path.
function resolveOperatorIdentityInputs(
  config: Config,
): Pick<DaemonEnvInputs, "operatorEmail" | "operatorName"> {
  const identity = resolveOperatorIdentity(config);
  if (identity === undefined) return {};
  return identity.name === undefined
    ? { operatorEmail: identity.email }
    : { operatorEmail: identity.email, operatorName: identity.name };
}

// Default to managed Temporal unless the opaque local config explicitly opts
// out — zero-config `stigmer up` must work on a fresh machine.
function isTemporalManaged(config: Config): boolean {
  const local = config.backend.local as { temporal?: { managed?: boolean } } | undefined;
  return local?.temporal?.managed !== false;
}

function buildStartupConfig(
  data: string,
  logs: string,
  temporalAddr: string,
  daemonPid: number,
  options: UpOptions,
): StartupConfig {
  return {
    data_dir: data,
    log_dir: logs,
    temporal_addr: temporalAddr,
    execution_mode: "local",
    sandbox_image: "",
    sandbox_auto_pull: false,
    sandbox_cleanup: false,
    sandbox_ttl: 0,
    stigmer_server_pid: daemonPid,
    server_only: options.serverOnly === true,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

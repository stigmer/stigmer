// Foreground control of the daemon: `up` (spawn + verify + wait-ready),
// `upForeground` (run the daemon body right here until a signal), `down`
// (signal + wait + safety-net cleanup), and a liveness check.
//
// Both `up` shapes resolve every heavy dependency first (Temporal binary,
// server launch, runner entry) so failures surface with a clear message before
// anything long-lived starts. The detached shape then re-execs this same CLI
// as the hidden `internal-daemon` and waits until the server's gRPC port
// answers; the foreground shape calls the same daemon body in-process, which
// is what a container entrypoint, a systemd unit or a tmux pane wants: one
// process to watch, signals delivered to it, the stack's output on its stdio.
//
// When the stack does not start, both shapes say why from the daemon's own
// record, the health snapshot `stigmer status` reads: which component failed,
// how, and its last stderr lines (stigmer#1845). The detached shape watches
// the daemon for the whole wait, so a start that has given up is reported at
// once, not when the wait runs out.

import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Config, load as loadConfig } from "../../config/config.js";
import { log } from "../../logger.js";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { ExitCode } from "../../errors/exit-codes.js";
import { DAEMON_PID_FILE, HEALTH_STATE_FILE, SERVER_PORT } from "../constants.js";
import { tcpConnects, waitForTcp } from "../net/tcp.js";
import { dataDir, logDir } from "../paths.js";
import { componentLogsHint, loadHealthState } from "../state/health-state.js";
import { readPidFile, removePidFile } from "../state/pidfile.js";
import { findProcessByPort, isOtherLiveProcess, isProcessAlive, killProcess, processCommand } from "../state/proc.js";
import { type StartupConfig, removeStartupConfig, saveStartupConfig } from "../state/startup-config.js";
import { rotateLogs } from "../state/log-rotation.js";
import { resolveApiKey, resolveProvider } from "../llm-config.js";
import { resolveOperatorIdentity } from "../operator-config.js";
import { ensureRunner } from "../runtime/runner.js";
import { ensureServer } from "../runtime/server.js";
import { TemporalManager } from "../temporal/manager.js";
import type { ProviderReach } from "../provider-reach.js";
import { localRunnerReach } from "./components.js";
import { buildDaemonEnv, type DaemonEnvInputs, readDaemonConfig } from "./env.js";
import { NodeProcessHost, type OutputMirror } from "./host.js";
import { type InternalDaemonDeps, runInternalDaemon, waitForShutdownSignal } from "./process.js";

/** How long `up` waits for the server's gRPC port after spawning the daemon. */
const READY_TIMEOUT_MS = 60_000;
/** The components whose failure stops the stack, in start order: the first
 * one recorded failed is the one a failed start names. */
const CRITICAL_COMPONENTS = ["temporal", "stigmer-server"] as const;
/** How long `down` waits for graceful daemon exit before force-killing. */
const STOP_TIMEOUT_MS = 15_000;
const STOP_POLL_MS = 500;

export interface UpOptions {
  serverOnly?: boolean;
  noWeb?: boolean;
}

/** What a started stack reports to the person who started it (`stigmer up`'s card). */
export interface UpReport {
  /**
   * The providers the stack's runner reaches, judged over the environment
   * the daemon gives it (the value the server was handed as
   * STIGMER_RUNNER_PROVIDERS, unless the operator exported one), or
   * undefined when the stack starts no runner.
   */
  readonly runnerReach: readonly ProviderReach[] | undefined;
}

/** Everything both `up` shapes need once the heavy resolution is done. */
interface PreparedLaunch {
  data: string;
  logs: string;
  temporalAddress: string;
  env: NodeJS.ProcessEnv;
}

/** Start the local stack in the background. Throws on any startup failure. */
export async function up(options: UpOptions = {}, home: string = homedir()): Promise<UpReport> {
  const { data, logs, temporalAddress, env } = await prepareLaunch(options, home);

  const daemonPid = spawnDaemon(env, join(logs, "daemon.log"));
  log.info("daemon process started", { pid: daemonPid });

  /* v8 ignore next -- @preserve: up() spawns the real daemon, which no unit test starts; waitForStack has its own tests, and the cli-up lane runs this end to end */
  await waitForStack({ data, logs, daemonPid });

  saveStartupConfig(data, buildStartupConfig(data, logs, temporalAddress, daemonPid, options));
  /* v8 ignore next -- @preserve: up() spawns the real daemon, which no unit test starts; the cli-up lane's smoke-getting-started runs it end to end, and upReport has its own tests */
  return upReport(env);
}

/** What waitForStack watches: the detached daemon, and where it records. */
export interface StackWait {
  data: string;
  logs: string;
  daemonPid: number;
  /** Default SERVER_PORT; injectable for tests. */
  port?: number;
  /** Default READY_TIMEOUT_MS; injectable for tests. */
  timeoutMs?: number;
}

/**
 * Wait until the server answers, watching the daemon the whole time: the
 * daemon exits as soon as a critical component fails, so its exit ends the
 * wait at once, with the reason it recorded. Throws the failure, or, with no
 * record, says the daemon died (its log has the rest) or that the wait ran out.
 */
export async function waitForStack(wait: StackWait): Promise<void> {
  const { data, logs, daemonPid } = wait;
  try {
    await waitForTcp({
      port: wait.port ?? SERVER_PORT,
      timeoutMs: wait.timeoutMs ?? READY_TIMEOUT_MS,
      label: "stigmer-server",
      getExit: () => (isProcessAlive(daemonPid) ? null : { code: null, signal: null }),
    });
  } catch (err) {
    const failure = startupFailure(data, daemonPid);
    if (failure !== null) throw failure;
    if (!isProcessAlive(daemonPid)) {
      throw new CliExitError("daemon process crashed during startup", ExitCode.General, [
        `Check ${join(logs, "daemon.log")} for details.`,
      ]);
    }
    throw err;
  }
}

/**
 * Why the stack did not start, from the daemon's own record: the first
 * critical component recorded failed, how it failed, its last stderr lines and
 * where its full log is. Null when there is no such record from this daemon
 * (`daemonPid`): one left by an earlier run never speaks for this one.
 */
export function startupFailure(data: string, daemonPid: number): CliExitError | null {
  const snapshot = loadHealthState(join(data, HEALTH_STATE_FILE));
  if (snapshot === null || snapshot.daemon_pid !== daemonPid) return null;
  for (const name of CRITICAL_COMPONENTS) {
    const component = snapshot.components[name];
    if (component?.state !== "failed") continue;
    const output = (component.last_output ?? []).map((line) => `  ${line}`);
    return new CliExitError(`${name} did not start: ${component.last_error ?? "it failed"}`, ExitCode.General, [
      ...output,
      componentLogsHint(name),
    ]);
  }
  return null;
}

// The daemon reads its configuration from the very environment the launcher
// built, so reading it here gives the runner environment the daemon builds.
function upReport(env: NodeJS.ProcessEnv): UpReport {
  return { runnerReach: localRunnerReach(readDaemonConfig(env), env) };
}

/** Seams of the foreground launcher, injectable for tests. */
export interface UpForegroundDeps {
  /** The daemon body (default: the real one). */
  runDaemon?: (deps: InternalDaemonDeps) => Promise<number>;
  /** Resolves when the stack should shut down (default: the first SIGTERM/SIGINT). */
  waitForShutdown?: () => Promise<void>;
  /** Receives each line the server and runner write (default: a `[component]`-prefixed stdout mirror). */
  mirror?: OutputMirror;
  /** Invoked once the stack is serving — the moment a detached `up` would have returned — with what it reports. */
  onReady?: (report: UpReport) => void | Promise<void>;
  /** The port the stack's server must find free (default SERVER_PORT). */
  serverPort?: number;
}

/**
 * Start the local stack in THIS process and run it until shutdown is requested.
 * Resolves to the daemon's exit code: 0 after a clean shutdown, 1 when a
 * critical component failed to start (the daemon has already logged why).
 *
 * The same resolution, the same daemon body and the same on-disk state as
 * `up`, so `stigmer status` and `stigmer down` from another shell see an
 * ordinary daemon whose PID happens to be ours. The children receive the very
 * environment a detached daemon would have inherited, and what a detached `up`
 * does once the server answers — the startup record — happens in `onStarted`,
 * at the same point in the stack's life. The server makes its own
 * organization before it answers, so there is nothing else to do.
 */
export async function upForeground(
  options: UpOptions = {},
  home: string = homedir(),
  deps: UpForegroundDeps = {},
): Promise<number> {
  const { data, logs, temporalAddress, env } = await prepareLaunch(options, home, deps.serverPort);
  const runDaemon = deps.runDaemon ?? runInternalDaemon;

  return runDaemon({
    config: readDaemonConfig(env),
    env,
    host: new NodeProcessHost({ mirror: deps.mirror ?? mirrorToStdout }),
    waitForShutdown: deps.waitForShutdown ?? waitForShutdownSignal,
    onStarted: async () => {
      saveStartupConfig(data, buildStartupConfig(data, logs, temporalAddress, process.pid, options));
      await deps.onReady?.(upReport(env));
    },
  });
}

// The default foreground mirror: one line per child line, tagged with the
// component, on stdout — a terminal in a tmux pane, `docker logs` in a
// container. The log files keep receiving the same bytes untagged.
const mirrorToStdout: OutputMirror = (component, line) => {
  process.stdout.write(`[${component}] ${line}\n`);
};

// The part of `up` that is the same whether the daemon then runs detached or
// right here: refuse a second stack, prepare the state dirs, resolve every
// heavy dependency, and encode the launcher→daemon contract.
async function prepareLaunch(options: UpOptions, home: string, serverPort: number = SERVER_PORT): Promise<PreparedLaunch> {
  const data = dataDir(home);
  const logs = logDir(home);

  cleanupOrphans(data);
  await refuseHeldPort(serverPort);

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

  // Resolves the server (repo tree or the acquired @stigmer/server-slim).
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

  return { data, logs, temporalAddress: temporal.address, env };
}

/** Stop the local stack. Returns false if nothing was running. */
export async function down(home: string = homedir()): Promise<boolean> {
  const data = dataDir(home);
  let pid = readPidFile(join(data, DAEMON_PID_FILE));
  if (pid === null) pid = findProcessByPort(SERVER_PORT);

  if (pid === null || !isOtherLiveProcess(pid)) {
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

/** Whether the daemon is running: a live peer's PID, else a server-port fallback. */
export async function isRunning(home: string = homedir()): Promise<boolean> {
  const data = dataDir(home);
  const pid = readPidFile(join(data, DAEMON_PID_FILE));
  if (pid !== null) {
    if (isOtherLiveProcess(pid)) return true;
    removePidFile(join(data, DAEMON_PID_FILE)); // stale (dead, or a previous life of our own PID)
  }
  return tcpConnects(SERVER_PORT, "127.0.0.1", 1000);
}

// Refuse to start beside whatever already answers on the server's port: an
// earlier stack still up, or another program. A server started beside it would
// die on "address in use" while its readiness checks connected to the other
// program, so this is refused before anything starts, naming the holder.
// `stigmer down` is offered only for a Stigmer process: with no daemon PID
// file it stops whatever holds the port.
async function refuseHeldPort(port: number): Promise<void> {
  if (!(await tcpConnects(port, "127.0.0.1", 1000))) return;
  const holder = findProcessByPort(port);
  const command = holder === null ? null : processCommand(holder);
  const named = holder === null ? "" : ` by pid ${holder}${command === null ? "" : ` (${shorten(command)})`}`;
  const hint =
    command !== null && command.includes("stigmer")
      ? "It looks like an earlier Stigmer stack; stop it with: stigmer down"
      : "Stop the program holding it, then run stigmer up again.";
  throw new CliExitError(`port ${port} is already in use${named}`, ExitCode.General, [hint]);
}

function shorten(command: string): string {
  return command.length > 120 ? `${command.slice(0, 119)}…` : command;
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

// Kill any daemon/server/runner left alive by a previous, improperly-stopped
// run. A recorded PID that is our own is a leftover, never a peer (the fresh
// PID namespace of a restarted container hands the launcher the PID its last
// life had) — signalling it would be signalling ourselves.
function cleanupOrphans(data: string): void {
  for (const name of [DAEMON_PID_FILE, "stigmer-server.pid", "runner.pid"]) {
    const pidPath = join(data, name);
    const pid = readPidFile(pidPath);
    if (pid === null) continue;
    if (isOtherLiveProcess(pid)) {
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
// var is set this re-writes the same value. The Anthropic key is the one `stigmer
// setup` saves, so it is the only key with a persisted delivery path; the runner
// reaches other providers through the environment it inherits.
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

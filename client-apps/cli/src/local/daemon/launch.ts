// Foreground control of the daemon: `up` (spawn + verify + wait-ready),
// `upForeground` (run the daemon body right here until a signal), `down`
// (signal + wait + safety-net cleanup), and a liveness check.
//
// Both `up` shapes resolve every heavy dependency first (Temporal binary,
// server launch, runner entry) so failures surface with a clear message before
// anything long-lived starts. The detached shape then re-execs this same CLI
// as the hidden `internal-daemon` and waits until the server's gRPC port
// answers and, when the stack has a runner, until the daemon records the
// runner ready (stigmer#1629); the foreground shape calls the same daemon
// body in-process, which is what a container entrypoint, a systemd unit or a
// tmux pane wants: one process to watch, signals delivered to it, the stack's
// output on its stdio.
//
// When the stack does not start, both shapes say why from the daemon's own
// record, the health snapshot `stigmer status` reads: which component failed
// (the runner among them), how, and its last stderr lines (stigmer#1845). The
// detached shape watches the daemon for the whole wait, so a start that has
// given up is reported at once, not when the wait runs out.
//
// A running stack is never touched by `up`: it refuses while the daemon on
// record lives, and sweeps only a dead daemon's leftovers. `down` reports a
// stack stopped only once nothing of it is left: the daemon's own teardown,
// then one sweep of whatever a daemon that died untidily left behind, waiting
// for each leftover to exit (stigmer#1175).

import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { type Config, load as loadConfig } from "../../config/config.js";
import { log } from "../../logger.js";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { ExitCode } from "@stigmer/client/exit-codes";
import { DAEMON_PID_FILE, HEALTH_STATE_FILE, SERVER_PORT } from "../constants.js";
import { tcpConnects, waitForTcp } from "../net/tcp.js";
import { dataDir, logDir } from "../paths.js";
import { componentLogsHint, loadHealthState } from "../state/health-state.js";
import { readPidRecord, recordedLiveProcess, removePidFile } from "../state/pidfile.js";
import { findProcessByPort, isOtherLiveProcess, isProcessAlive, killProcess, processCommand } from "../state/proc.js";
import { type StartupConfig, removeStartupConfig, saveStartupConfig } from "../state/startup-config.js";
import { rotateLogs } from "../state/log-rotation.js";
import { resolveApiKey, resolveProvider } from "../llm-config.js";
import { resolveOperatorIdentity } from "../operator-config.js";
import { ensureRunner } from "../runtime/runner.js";
import { ensureServer } from "../runtime/server.js";
import { TemporalManager } from "../temporal/manager.js";
import type { ProviderReach } from "../provider-reach.js";
import { localRunnerReach, RUNNER_GATE_TIMEOUT_MS } from "./components.js";
import { buildDaemonEnv, type DaemonEnvInputs, readDaemonConfig } from "./env.js";
import { NodeProcessHost, type OutputMirror } from "./host.js";
import { type InternalDaemonDeps, runInternalDaemon } from "./process.js";
import { shutdownOnSignals } from "./signals.js";
import { GRACEFUL_STOP_TIMEOUT_MS } from "./supervisor.js";

/** How long `up` waits for the server's gRPC port after spawning the daemon. */
const READY_TIMEOUT_MS = 60_000;
/**
 * How long `up` waits, once the server answers, for the daemon to record the
 * runner ready: the daemon's own runner gate, plus room for the teardown that
 * follows a failed gate, so the launcher never gives up while the daemon is
 * still deciding.
 */
const RUNNER_READY_TIMEOUT_MS = RUNNER_GATE_TIMEOUT_MS + 30_000;
/** How often `up` reads the daemon's record while it waits for the runner. */
const RUNNER_READY_POLL_MS = 250;
/** The components whose failure stops the stack, in start order: the first
 * one recorded failed is the one a failed start names. */
const CRITICAL_COMPONENTS = ["temporal", "stigmer-server", "runner"] as const;
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
  await waitForStack({ data, logs, daemonPid, runner: options.serverOnly !== true });

  saveStartupConfig(data, buildStartupConfig(data, logs, temporalAddress, daemonPid, options));
  /* v8 ignore next -- @preserve: up() spawns the real daemon, which no unit test starts; the cli-up lane's smoke-getting-started runs it end to end, and upReport has its own tests */
  return upReport(env);
}

/** What waitForStack watches: the detached daemon, and where it records. */
export interface StackWait {
  data: string;
  logs: string;
  daemonPid: number;
  /** Whether the stack starts a runner; the wait then lasts until the daemon records it ready. */
  runner: boolean;
  /** Default SERVER_PORT; injectable for tests. */
  port?: number;
  /** Default READY_TIMEOUT_MS; injectable for tests. */
  timeoutMs?: number;
  /** Default RUNNER_READY_TIMEOUT_MS; injectable for tests. */
  runnerTimeoutMs?: number;
}

/**
 * Wait until the server answers and, with a runner, until this daemon's record
 * shows the runner ready, watching the daemon the whole time: the daemon exits
 * as soon as a critical component fails, so its exit ends the wait at once,
 * with the reason it recorded. Only that exit ends it: a runner recorded
 * failed while the daemon still stops the stack is not yet a stopped stack.
 * Throws the failure, or, with no record, says the daemon died (its log has
 * the rest) or that the wait ran out.
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
    if (wait.runner) await waitForRunnerReady(data, daemonPid, wait.runnerTimeoutMs ?? RUNNER_READY_TIMEOUT_MS);
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

// Poll this daemon's record until it shows the runner ready. The daemon writes
// that once its start is done, right after the runner passes its gate.
async function waitForRunnerReady(data: string, daemonPid: number, timeoutMs: number): Promise<void> {
  const path = join(data, HEALTH_STATE_FILE);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = loadHealthState(path);
    if (snapshot?.daemon_pid === daemonPid && snapshot.components.runner?.ready === true) return;
    if (!isProcessAlive(daemonPid)) throw new Error("the daemon exited before the runner was ready");
    await delay(RUNNER_READY_POLL_MS);
  }
  throw new CliExitError(`runner did not report ready within ${timeoutMs / 1000} s`, ExitCode.General, [componentLogsHint("runner")]);
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
  /**
   * Aborted when the stack should stop (default: the first SIGTERM/SIGINT,
   * armed just before the daemon body starts, so a Ctrl-C while dependencies
   * are still resolving ends the launcher at once, as it always has).
   */
  shutdown?: AbortSignal;
  /** Receives each line the server and runner write (default: a `[component]`-prefixed stdout mirror). */
  mirror?: OutputMirror;
  /** Invoked once the stack is serving — the moment a detached `up` would have returned — with what it reports. */
  onReady?: (report: UpReport) => void | Promise<void>;
  /** The port the stack's server listens on, refused when already held (default SERVER_PORT). */
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
    shutdown: deps.shutdown ?? shutdownOnSignals(),
    onStarted: async () => {
      saveStartupConfig(data, buildStartupConfig(data, logs, temporalAddress, process.pid, options));
      await deps.onReady?.(upReport(env));
    },
    serverPort: deps.serverPort,
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

  refuseRunningStack(data);
  await cleanupOrphans(data);
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

/**
 * Stop the local stack. Returns false if nothing was running. `serverPort` is
 * where to look for a stack whose daemon left no PID file; tests move it off
 * the real port.
 */
export async function down(home: string = homedir(), serverPort: number = SERVER_PORT): Promise<boolean> {
  const data = dataDir(home);
  // A daemon on record is signalled only while it is the process recorded; a
  // record naming another program now is stale, like a dead one. With no
  // record at all, the server port's holder is the stack only when it is a
  // Stigmer process (the rule refuseHeldPort applies to the same port).
  const pidPath = join(data, DAEMON_PID_FILE);
  const pid = readPidRecord(pidPath) === null ? stigmerPortHolder(serverPort) : recordedLiveProcess(pidPath);

  if (pid === null || !isOtherLiveProcess(pid)) {
    removePidFile(pidPath);
    await clearLeftovers(home, data);
    return false;
  }

  // The daemon traps SIGTERM and tears down children + Temporal in order.
  killProcess(pid, "SIGTERM");
  log.info("sent SIGTERM to daemon", { pid });

  if (!(await waitForExit(pid, STOP_TIMEOUT_MS))) {
    log.warn("daemon did not stop gracefully, force killing", { pid });
    killProcess(pid, "SIGKILL");
  }
  removePidFile(pidPath);
  removeStartupConfig(data);
  // Nothing to do after a clean teardown; after a forced one, or a daemon that
  // could not finish its own, this is what stops the rest.
  await clearLeftovers(home, data);
  return true;
}

/**
 * Whether the daemon is running: the live daemon on record, else a server-port
 * fallback. `serverPort` is that port; tests move it off the real one.
 */
export async function isRunning(home: string = homedir(), serverPort: number = SERVER_PORT): Promise<boolean> {
  const pidPath = join(dataDir(home), DAEMON_PID_FILE);
  if (recordedLiveProcess(pidPath) !== null) return true;
  removePidFile(pidPath); // stale (dead, a previous life of our own PID, or another program now)
  return tcpConnects(serverPort, "127.0.0.1", 1000);
}

// The process holding the server's port when its command line names Stigmer;
// null for nothing, or for another program, which `down` leaves alone.
function stigmerPortHolder(port: number): number | null {
  const holder = findProcessByPort(port);
  if (holder === null) return null;
  const command = processCommand(holder);
  if (command !== null && command.includes("stigmer")) return holder;
  log.info(`port ${port} is held by a program that is not Stigmer; leaving it alone`, {
    pid: holder,
    ...(command === null ? {} : { command: shorten(command) }),
  });
  return null;
}

// Refuse to start beside a stack that is running, still starting or still
// stopping: the daemon on record is alive. `stigmer up` also calls it before
// asking for a model key on a terminal, so it never asks, then refuses. Nothing is touched; `down` is the
// one way to stop it. A recorded PID that is dead, our own, or names another
// program now is a leftover, never a stack: its record is dropped here, so the
// sweep after (cleanupOrphans) neither re-reads nor re-reports it.
export function refuseRunningStack(data: string): void {
  const pidPath = join(data, DAEMON_PID_FILE);
  const pid = recordedLiveProcess(pidPath);
  if (pid === null) {
    removePidFile(pidPath);
    return;
  }
  throw new CliExitError(`the local Stigmer stack is already running (daemon pid ${pid})`, ExitCode.General, [
    "Stop it with: stigmer down",
  ]);
}

// Refuse to start beside whatever already answers on the server's port: an
// earlier stack still up, or another program. A server started beside it would
// die on "address in use" while its readiness checks connected to the other
// program, so this is refused before anything starts, naming the holder.
// `stigmer down` is offered only for a Stigmer process, the only holder it
// stops when no daemon PID file names the stack.
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

// Stop whatever a daemon that is gone left behind, in reverse start order: the
// recorded children, then managed Temporal.
async function clearLeftovers(home: string, data: string): Promise<void> {
  await cleanupOrphans(data);
  await stopManagedTemporal(home);
}

// Stop any daemon/server/runner left alive by a previous, improperly-stopped
// run, and return once each has exited: SIGTERM, then SIGKILL after the
// supervisor's grace, all in parallel, so a caller that next binds the
// server's port never races a dying server. Only the recorded PID is
// signalled, never its group, and only while it is the process recorded
// (recordedLiveProcess): a reused PID now naming another program is left
// alone and its file removed (stigmer#2750). A recorded PID that is our own is
// a leftover, never a peer (the fresh PID namespace of a restarted container
// hands the launcher the PID its last life had) — signalling it would be
// signalling ourselves.
async function cleanupOrphans(data: string): Promise<void> {
  await Promise.all(
    [DAEMON_PID_FILE, "stigmer-server.pid", "runner.pid"].map(async (name) => {
      const pidPath = join(data, name);
      const pid = recordedLiveProcess(pidPath);
      if (pid !== null) {
        log.warn("stopping orphaned process from a previous run", { file: name, pid });
        killProcess(pid, "SIGTERM");
        if (!(await waitForExit(pid, GRACEFUL_STOP_TIMEOUT_MS))) {
          log.warn("orphaned process did not stop gracefully, force killing", { file: name, pid });
          killProcess(pid, "SIGKILL");
          await waitForExit(pid, GRACEFUL_STOP_TIMEOUT_MS);
        }
      }
      removePidFile(pidPath);
    }),
  );
}

// Poll until `pid` has exited; false if it outlives `timeoutMs`.
async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (isProcessAlive(pid)) {
    if (Date.now() >= deadline) return false;
    await sleep(STOP_POLL_MS);
  }
  return true;
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

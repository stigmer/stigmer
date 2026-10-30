// The supervised daemon body — the `stigmer internal-daemon` entry point.
//
// It brings the local stack up in the canonical order (managed Temporal, then
// the gated server, then the runner), records a health snapshot readers can
// trust, runs the 10s health monitor, and when a stop is requested tears down
// in reverse whatever has started. A stop is honoured from the first instant,
// startup included (stigmer#1175): the body looks at the request after every
// bounded startup step, the supervisor stops a child still behind its gate,
// and the stack is never reported started once a stop was asked for. A
// requested stop exits 0, wherever it landed. Temporal, the process host, the
// clock, and the stop request are all injectable so the whole body can be
// driven in a test without real signals or a real Temporal.

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Logger, log as defaultLog } from "../../logger.js";
import { DAEMON_PID_FILE, HEALTH_STATE_FILE, SERVER_PORT } from "../constants.js";
import { type HealthState, writeHealthState } from "../state/health-state.js";
import { removePidFile, writePidFile } from "../state/pidfile.js";
import { TemporalManager } from "../temporal/manager.js";
import { TemporalSupervisor } from "../temporal/supervisor.js";
import { isWebConsoleAvailable } from "../webconsole/index.js";
import { buildComponents } from "./components.js";
import { type DaemonConfig, readDaemonConfig } from "./env.js";
import { NodeProcessHost, systemClock } from "./host.js";
import { HEALTH_CHECK_INTERVAL_MS, ProcessSupervisor, SETTLE_DELAY_MS } from "./supervisor.js";
import type { Clock, ProcessHost } from "./types.js";

/** The Temporal lifecycle surface the daemon drives. TemporalManager (+ its
 * supervisor) satisfies it; tests provide a fake. */
export interface TemporalControl {
  readonly address: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): Promise<boolean>;
  getPid(): number | null;
  startSupervisor(): void;
  stopSupervisor(): void;
}

export interface InternalDaemonDeps {
  config?: DaemonConfig;
  /**
   * The environment the children inherit (defaults to this process's). The
   * detached daemon IS the environment the launcher built for it; the
   * foreground launcher passes that same built environment here so the
   * children see exactly what they would have seen detached.
   */
  env?: NodeJS.ProcessEnv;
  host?: ProcessHost;
  clock?: Clock;
  temporal?: TemporalControl;
  log?: Logger;
  /**
   * Aborted when a stop is requested (real entry: SIGTERM/SIGINT, armed by
   * `shutdownOnSignals` before anything starts).
   */
  shutdown: AbortSignal;
  /**
   * Invoked once the stack is up and the monitor is running, and awaited
   * before the daemon settles into waiting for shutdown; never invoked once a
   * stop has been requested. The foreground launcher does its post-readiness
   * work here (the startup record, the success card); tests use it to observe
   * "started".
   */
  onStarted?: () => void | Promise<void>;
}

/** Run the daemon to completion. Returns the process exit code. */
export async function runInternalDaemon(deps: InternalDaemonDeps): Promise<number> {
  const config = deps.config ?? readDaemonConfig();
  const host = deps.host ?? new NodeProcessHost();
  const clock = deps.clock ?? systemClock;
  const log = deps.log ?? defaultLog;
  const { shutdown } = deps;

  mkdirSync(config.logDir, { recursive: true });
  mkdirSync(join(config.dataDir, "workspace"), { recursive: true });
  writePidFile(join(config.dataDir, DAEMON_PID_FILE), process.pid);

  const healthState: HealthState = {
    daemon_pid: process.pid,
    started_at: new Date(clock.now()).toISOString(),
    components: {},
  };
  const healthPath = join(config.dataDir, HEALTH_STATE_FILE);
  const persist = (): void => writeHealthState(healthPath, healthState);

  const temporal = deps.temporal ?? (config.temporalManaged ? buildTemporal(config, log) : null);
  let temporalStarted = false;
  let started: ProcessSupervisor | null = null;
  let monitor: ReturnType<typeof setInterval> | null = null;

  // The one teardown, in reverse start order, of whatever has started. After a
  // failed start the daemon's record stays, for `up` to say why; after a
  // requested stop nothing is left.
  const stopStack = async (keepRecord: boolean): Promise<void> => {
    if (monitor !== null) clearInterval(monitor);
    if (started !== null) await started.shutdown();
    if (temporal !== null && temporalStarted) {
      temporal.stopSupervisor();
      log.info("stopping managed Temporal");
      await temporal.stop().catch((err) => log.warn("failed to stop managed Temporal cleanly", { error: String(err) }));
      if (healthState.components.temporal !== undefined) healthState.components.temporal.state = "stopped";
    }
    persist();
    if (keepRecord) return;
    removePidFile(join(config.dataDir, DAEMON_PID_FILE));
    removePidFile(healthPath);
    log.info("daemon shutdown complete");
  };
  const stopRequested = async (): Promise<number> => {
    log.info("stop requested during startup");
    await stopStack(false);
    return 0;
  };

  if (shutdown.aborted) return stopRequested();

  // --- Start managed Temporal first (the server and runner depend on it). ---
  if (temporal !== null) {
    log.info("starting managed Temporal");
    healthState.components.temporal = { pid: 0, state: "stopped", started_at: "", restart_count: 0 };
    try {
      await temporal.start();
    } catch (err) {
      healthState.components.temporal.state = "failed";
      healthState.components.temporal.last_error = err instanceof Error ? err.message : String(err);
      persist();
      log.error("failed to start managed Temporal", { error: String(err) });
      return 1;
    }
    temporalStarted = true;
    healthState.components.temporal.pid = temporal.getPid() ?? 0;
    healthState.components.temporal.state = "running";
    healthState.components.temporal.started_at = new Date(clock.now()).toISOString();
    temporal.startSupervisor();
    persist();
    if (shutdown.aborted) return stopRequested();
  }

  // --- Start the server (gated) and runner via the supervisor. ---
  const supervisor = new ProcessSupervisor(buildComponents(config, deps.env ?? process.env), {
    host,
    clock,
    healthState,
    persist,
    log,
  });
  started = supervisor;
  const result = await supervisor.startAll(shutdown);
  if (result.stopped === true) return stopRequested();
  if (!result.ok) {
    const failed = result.failedCritical === undefined ? undefined : healthState.components[result.failedCritical];
    log.error("critical component failed to start", { component: result.failedCritical, error: failed?.last_error });
    // A server that hangs without opening its port is still running: stop what
    // started, in reverse, as a clean shutdown would, so a failed start leaves
    // nothing behind holding the port.
    await stopStack(true);
    return 1;
  }

  // Let processes settle, then catch anything that crashed immediately.
  await clock.sleep(SETTLE_DELAY_MS);
  if (shutdown.aborted) return stopRequested();
  supervisor.settleCheck();

  // Web console: the SERVER serves it from its unified port; the
  // daemon probes and records what a browser would actually find. pid 0 is
  // truthful — there is no separate console process to supervise.
  const consoleAvailable = config.noWeb ? false : await isWebConsoleAvailable(SERVER_PORT, shutdown);
  if (shutdown.aborted) return stopRequested();
  healthState.components["web-console"] = {
    pid: 0,
    state: consoleAvailable ? "running" : "stopped",
    started_at: "",
    restart_count: 0,
  };
  if (config.noWeb) log.info("web console suppressed via --no-web");
  else if (!consoleAvailable) log.debug("server did not answer the console probe (no export bundled), skipping");
  persist();

  // --- Health monitor: sync Temporal + drive one supervisor tick per interval. ---
  monitor = setInterval(() => {
    void (async () => {
      if (temporal !== null) await syncTemporal(temporal, healthState);
      await supervisor.tick();
    })();
  }, HEALTH_CHECK_INTERVAL_MS);
  monitor.unref?.();

  log.info("daemon started", { pid: process.pid });
  await deps.onStarted?.();

  // --- Wait for the stop request, then tear down in reverse order. ---
  await untilAborted(shutdown);
  log.info("received shutdown signal");
  await stopStack(false);
  return 0;
}

// Resolve once `signal` aborts, at once if it already has.
function untilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

// Sync the Temporal component's health from its self-supervising manager.
async function syncTemporal(temporal: TemporalControl, healthState: HealthState): Promise<void> {
  const state = healthState.components.temporal;
  if (state === undefined) return;
  if (await temporal.isRunning()) {
    state.state = "running";
    state.pid = temporal.getPid() ?? state.pid;
    state.last_error = undefined;
  } else {
    state.state = "unhealthy";
  }
}

// Build the real managed-Temporal control from the ~/.stigmer layout (home is
// two levels up from the data dir: ~/.stigmer/data -> ~).
function buildTemporal(config: DaemonConfig, log: Logger): TemporalControl {
  const home = dirname(dirname(config.dataDir));
  const manager = TemporalManager.forHome(home);
  let supervisor: TemporalSupervisor | null = null;
  return {
    get address() {
      return manager.address;
    },
    start: () => manager.start(),
    stop: () => manager.stop(),
    isRunning: () => manager.isRunning(),
    getPid: () => manager.getPid(),
    startSupervisor: () => {
      supervisor = new TemporalSupervisor(manager, { log });
      supervisor.start();
    },
    stopSupervisor: () => supervisor?.stop(),
  };
}

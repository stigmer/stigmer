// The supervised daemon body — the `stigmer internal-daemon` entry point.
//
// It brings the local stack up in the canonical order (managed Temporal, then
// the gated server, then the runner), records a health snapshot readers can
// trust, runs the 10s health monitor, and on a shutdown signal tears everything
// down in reverse. Temporal, the process host, the clock, and the shutdown
// trigger are all injectable so the whole body can be driven in a test without
// real signals or a real Temporal.

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Logger, log as defaultLog } from "../../logger.js";
import { DAEMON_PID_FILE, HEALTH_STATE_FILE } from "../constants.js";
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
  host?: ProcessHost;
  clock?: Clock;
  temporal?: TemporalControl;
  log?: Logger;
  /** Resolves when shutdown is requested (real entry: SIGTERM/SIGINT). */
  waitForShutdown: () => Promise<void>;
  /** Invoked once the stack is up and the monitor is running (tests). */
  onStarted?: () => void;
}

/** Run the daemon to completion. Returns the process exit code. */
export async function runInternalDaemon(deps: InternalDaemonDeps): Promise<number> {
  const config = deps.config ?? readDaemonConfig();
  const host = deps.host ?? new NodeProcessHost();
  const clock = deps.clock ?? systemClock;
  const log = deps.log ?? defaultLog;

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

  // --- Start managed Temporal first (the server and runner depend on it). ---
  if (temporal !== null) {
    log.info("starting managed Temporal");
    healthState.components.temporal = { pid: 0, state: "stopped", started_at: "", restart_count: 0 };
    try {
      await temporal.start();
    } catch (err) {
      healthState.components.temporal.state = "failed";
      healthState.components.temporal.last_error = String(err);
      persist();
      log.error("failed to start managed Temporal", { error: String(err) });
      return 1;
    }
    healthState.components.temporal.pid = temporal.getPid() ?? 0;
    healthState.components.temporal.state = "running";
    healthState.components.temporal.started_at = new Date(clock.now()).toISOString();
    temporal.startSupervisor();
    persist();
  }

  // --- Start the server (gated) and runner via the supervisor. ---
  const supervisor = new ProcessSupervisor(buildComponents(config), { host, clock, healthState, persist, log });
  const result = await supervisor.startAll();
  if (!result.ok) {
    log.error("critical component failed to start", { component: result.failedCritical });
    if (temporal !== null) {
      temporal.stopSupervisor();
      await temporal.stop().catch(() => {});
    }
    return 1;
  }

  // Let processes settle, then catch anything that crashed immediately.
  await clock.sleep(SETTLE_DELAY_MS);
  supervisor.settleCheck();

  // Web console: the SERVER serves it from its unified port (DD-012); the
  // daemon probes and records what a browser would actually find. pid 0 is
  // truthful — there is no separate console process to supervise.
  const consoleAvailable = config.noWeb ? false : await isWebConsoleAvailable();
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
  const monitor = setInterval(() => {
    void (async () => {
      if (temporal !== null) await syncTemporal(temporal, healthState);
      await supervisor.tick();
    })();
  }, HEALTH_CHECK_INTERVAL_MS);
  monitor.unref?.();

  log.info("daemon started", { pid: process.pid });
  deps.onStarted?.();

  // --- Wait for shutdown, then tear down in reverse order. ---
  await deps.waitForShutdown();
  log.info("received shutdown signal");
  clearInterval(monitor);

  await supervisor.shutdown();

  if (temporal !== null) {
    temporal.stopSupervisor();
    log.info("stopping managed Temporal");
    await temporal.stop().catch((err) => log.warn("failed to stop managed Temporal cleanly", { error: String(err) }));
    if (healthState.components.temporal !== undefined) healthState.components.temporal.state = "stopped";
  }

  persist();
  removePidFile(join(config.dataDir, DAEMON_PID_FILE));
  removePidFile(healthPath);
  log.info("daemon shutdown complete");
  return 0;
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

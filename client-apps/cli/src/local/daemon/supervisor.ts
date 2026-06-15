// The child-process supervision policy: start order, readiness gating, crash
// restart with rapid-crash and max-restart guards, server health probing, and
// reverse-order shutdown.
//
// Every side effect (spawning, time, the health probe) is injected, so this
// whole policy is unit-testable without real processes or real waiting — the
// property the Go daemon never had. process.ts wires this to the real host,
// clock, Temporal, signals, and the 10s tick.

import { SERVER_PORT } from "../constants.js";
import { type Logger, log as defaultLog } from "../../logger.js";
import { tcpConnects } from "../net/tcp.js";
import type { ComponentState, HealthState } from "../state/health-state.js";
import { removePidFile, writePidFile } from "../state/pidfile.js";
import type { ChildHandle, Clock, ComponentSpec, ProcessHost } from "./types.js";

export const MAX_RESTARTS = 5;
export const RAPID_CRASH_WINDOW_MS = 5_000;
export const MAX_UNHEALTHY_CHECKS = 3;
export const GRACEFUL_STOP_TIMEOUT_MS = 5_000;
export const SETTLE_DELAY_MS = 2_000;
export const HEALTH_CHECK_INTERVAL_MS = 10_000;

export interface SupervisorDeps {
  host: ProcessHost;
  clock: Clock;
  /** Shared snapshot; the supervisor owns the components map. */
  healthState: HealthState;
  /** Persist the snapshot (atomic health-state write). */
  persist: () => void;
  log?: Logger;
  /** TCP probe for the server health check; injectable for tests. */
  probe?: (port: number) => Promise<boolean>;
  serverPort?: number;
}

/** Result of the initial start sequence. */
export interface StartResult {
  ok: boolean;
  /** Name of the critical component that failed, if any. */
  failedCritical?: string;
}

interface Managed {
  spec: ComponentSpec;
  state: ComponentState;
  handle: ChildHandle | null;
  unhealthyCount: number;
  exitWaiter: Promise<void> | null;
}

export class ProcessSupervisor {
  private readonly managed: Managed[];
  private readonly host: ProcessHost;
  private readonly clock: Clock;
  private readonly healthState: HealthState;
  private readonly persist: () => void;
  private readonly log: Logger;
  private readonly probe: (port: number) => Promise<boolean>;
  private readonly serverPort: number;

  constructor(specs: ComponentSpec[], deps: SupervisorDeps) {
    this.host = deps.host;
    this.clock = deps.clock;
    this.healthState = deps.healthState;
    this.persist = deps.persist;
    this.log = deps.log ?? defaultLog;
    this.probe = deps.probe ?? ((port) => tcpConnects(port, "127.0.0.1", 500));
    this.serverPort = deps.serverPort ?? SERVER_PORT;

    this.managed = specs.map((spec) => {
      const state: ComponentState = { pid: 0, state: "stopped", started_at: "", restart_count: 0 };
      this.healthState.components[spec.name] = state;
      return { spec, state, handle: null, unhealthyCount: 0, exitWaiter: null };
    });
  }

  /**
   * Start all components in order. A critical component that fails to start or
   * gate aborts startup (returns failedCritical); a non-critical failure is
   * recorded and skipped.
   */
  async startAll(): Promise<StartResult> {
    for (const m of this.managed) {
      this.log.info("starting component", { component: m.spec.name });
      try {
        this.spawn(m);
      } catch (err) {
        m.state.state = "failed";
        m.state.last_error = String(err);
        this.log.error("failed to start component", { component: m.spec.name, error: String(err) });
        if (m.spec.critical) {
          this.persist();
          return { ok: false, failedCritical: m.spec.name };
        }
        continue;
      }

      if (m.spec.gate !== undefined && m.handle !== null) {
        try {
          await m.spec.gate.wait(m.handle);
          this.log.info("component ready", { component: m.spec.name, gate: m.spec.gate.description });
        } catch (err) {
          m.state.state = "failed";
          m.state.last_error = `not ready: ${String(err)}`;
          this.persist();
          if (m.spec.critical) return { ok: false, failedCritical: m.spec.name };
        }
      }
    }
    this.persist();
    return { ok: true };
  }

  /** After a brief settle, mark any component that already crashed as failed. */
  settleCheck(): void {
    for (const m of this.managed) {
      if (m.handle !== null && m.handle.hasExited()) {
        m.state.state = "failed";
        m.state.last_error = "crashed during startup";
        this.log.error("component crashed during startup", { component: m.spec.name, pid: m.state.pid });
      }
    }
    this.persist();
  }

  /** One health-monitor iteration: restart crashed children, probe the server. */
  async tick(): Promise<void> {
    for (const m of this.managed) {
      if (m.handle === null || m.state.state === "failed") continue;

      if (m.handle.hasExited()) {
        this.log.warn("component exited, attempting restart", { component: m.spec.name, pid: m.state.pid });
        await this.tryRestart(m);
        continue;
      }

      if (m.spec.name === "stigmer-server") {
        await this.probeServer(m);
      }
    }
    this.persist();
  }

  /** Gracefully stop all components in reverse start order. */
  async shutdown(): Promise<void> {
    for (let i = this.managed.length - 1; i >= 0; i -= 1) {
      const m = this.managed[i];
      if (m.handle === null || m.handle.hasExited()) continue;
      this.log.info("stopping component", { component: m.spec.name, pid: m.state.pid });
      await this.killAndWait(m);
      removePidFile(m.spec.pidFile);
      m.state.state = "stopped";
    }
    this.persist();
  }

  private async probeServer(m: Managed): Promise<void> {
    if (await this.probe(this.serverPort)) {
      if (m.unhealthyCount > 0 || m.state.state === "unhealthy") {
        m.unhealthyCount = 0;
        m.state.state = "running";
        m.state.last_error = undefined;
        this.log.info("component recovered — gRPC port responding again", { component: m.spec.name });
      }
      return;
    }
    m.unhealthyCount += 1;
    this.log.warn("gRPC port not responding", { component: m.spec.name, consecutive_failures: m.unhealthyCount });
    if (m.unhealthyCount >= MAX_UNHEALTHY_CHECKS) {
      this.log.error("unhealthy threshold exceeded, restarting", { component: m.spec.name });
      await this.killAndWait(m);
      await this.tryRestart(m);
    } else {
      m.state.state = "unhealthy";
      m.state.last_error = "gRPC port not responding";
    }
  }

  private async tryRestart(m: Managed): Promise<void> {
    const startedAtMs = m.state.started_at !== "" ? Date.parse(m.state.started_at) : 0;
    if (startedAtMs > 0 && this.clock.now() - startedAtMs < RAPID_CRASH_WINDOW_MS) {
      m.state.state = "failed";
      m.state.last_error = "crashed immediately after start (likely a configuration or dependency error)";
      this.log.error("component crashed too quickly, marking failed", { component: m.spec.name });
      return;
    }
    if (m.state.restart_count >= MAX_RESTARTS) {
      m.state.state = "failed";
      m.state.last_error = `exceeded max restarts (${MAX_RESTARTS})`;
      this.log.error("component exceeded max restarts, marking failed", { component: m.spec.name });
      return;
    }
    removePidFile(m.spec.pidFile);
    m.state.restart_count += 1;
    try {
      this.spawn(m);
      this.log.info("component restarted", { component: m.spec.name, restart_count: m.state.restart_count });
    } catch (err) {
      m.state.state = "failed";
      m.state.last_error = String(err);
      this.log.error("failed to restart component", { component: m.spec.name, error: String(err) });
    }
  }

  // Spawn (or respawn) one component, wiring exit/readiness and writing its PID.
  private spawn(m: Managed): void {
    const request = m.spec.resolve();
    const handle = this.host.spawn(request);
    m.handle = handle;
    m.unhealthyCount = 0;

    m.exitWaiter = new Promise<void>((resolve) => {
      handle.onExit(() => resolve());
    });
    handle.onReady(() => {
      m.state.ready = true;
      this.log.info("component announced readiness", { component: m.spec.name });
    });

    m.state.pid = handle.pid;
    m.state.state = "running";
    m.state.started_at = new Date(this.clock.now()).toISOString();
    m.state.last_error = undefined;
    if (request.readinessMarker !== undefined) m.state.ready = false;

    writePidFile(m.spec.pidFile, handle.pid);
  }

  // SIGTERM, wait for graceful exit, then SIGKILL as a last resort.
  private async killAndWait(m: Managed): Promise<void> {
    if (m.handle === null || m.handle.hasExited()) return;
    m.handle.kill("SIGTERM");
    const timedOut = await this.raceTimeout(m.exitWaiter, GRACEFUL_STOP_TIMEOUT_MS);
    if (timedOut && !m.handle.hasExited()) {
      this.log.warn("graceful stop timed out, sending SIGKILL", { component: m.spec.name });
      m.handle.kill("SIGKILL");
      if (m.exitWaiter !== null) await m.exitWaiter;
    }
  }

  // Resolve false if the waiter wins, true if the timeout wins.
  private async raceTimeout(waiter: Promise<void> | null, ms: number): Promise<boolean> {
    if (waiter === null) return false;
    const timeout = Symbol("timeout");
    const result = await Promise.race([waiter.then(() => undefined), this.clock.sleep(ms).then(() => timeout)]);
    return result === timeout;
  }
}

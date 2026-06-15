// Self-healing supervisor for the Temporal dev server.
//
// On a fixed interval it asks "is Temporal healthy?" and, if not, restarts it
// via the idempotent start path (which reuses healthy instances and cleans up
// stale ones). This is intentionally separate from the daemon's child
// supervisor: Temporal owns its own lifecycle and lock, so it carries its own
// watchdog — exactly the split the Go CLI uses.
//
// The check and backoff are dependency-injected (clock) so the policy is unit-
// testable without real time, and the loop never overlaps with itself.

import { type Logger, log as defaultLog } from "../../logger.js";

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_BACKOFF_MS = 1_000;

/** The minimal surface the supervisor drives. TemporalManager satisfies it. */
export interface SupervisedTarget {
  isRunning(): Promise<boolean>;
  start(): Promise<void>;
}

export interface SupervisorOptions {
  intervalMs?: number;
  backoffMs?: number;
  /** Injectable sleep, for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
  log?: Logger;
}

export class TemporalSupervisor {
  private readonly target: SupervisedTarget;
  private readonly intervalMs: number;
  private readonly backoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: Logger;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private ticking = false;

  constructor(target: SupervisedTarget, options: SupervisorOptions = {}) {
    this.target = target;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.log = options.log ?? defaultLog;
  }

  /** Begin monitoring. Returns immediately; the loop runs on a timer. */
  start(): void {
    if (this.timer !== null) return;
    this.stopped = false;
    this.log.info("starting Temporal supervisor", { interval_ms: this.intervalMs });
    const tick = (): void => {
      void this.checkHealthAndRestart().finally(() => {
        if (!this.stopped) this.timer = setTimeout(tick, this.intervalMs);
      });
    };
    this.timer = setTimeout(tick, this.intervalMs);
  }

  /** Stop monitoring. Safe to call multiple times. */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.log.info("stopping Temporal supervisor");
  }

  /**
   * One health check + conditional restart. Public for unit testing: it is the
   * whole supervision policy, exercised without real timers.
   */
  async checkHealthAndRestart(): Promise<void> {
    if (this.ticking) return; // never overlap a previous tick
    this.ticking = true;
    try {
      if (await this.target.isRunning()) {
        this.log.debug("Temporal health check passed");
        return;
      }
      this.log.warn("Temporal health check failed — attempting restart");
      await this.sleep(this.backoffMs);
      if (this.stopped) return; // bailed out during backoff
      try {
        await this.target.start();
        this.log.info("Temporal restarted");
      } catch (err) {
        this.log.error("failed to restart Temporal — will retry next check", { error: String(err) });
      }
    } finally {
      this.ticking = false;
    }
  }
}

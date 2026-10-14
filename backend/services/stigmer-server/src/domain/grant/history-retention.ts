/**
 * Access-history retention: removes, every hour, the access-history
 * entries older than the window a host declares
 * (`ServerExtension.accessHistoryRetentionDays`), in every organization,
 * deleted ones included. Composed only when a window is declared, so a
 * server with none keeps every entry, as before retention existed.
 *
 * It runs as the organization purge runner does
 * (domain/organization/purge/runner.ts): composed with the server over the
 * composed grant store (the library's adapter, or a host's own driver),
 * started with the server's loops, a first pass at once and then one per
 * interval on an `unref()`'d timer, stopped before the store closes.
 *
 * A pass computes its cutoff from its clock and the window, then asks the
 * store to remove the entries recorded before it a batch at a time
 * (`GrantStore.pruneChanges`), until a batch comes back short or the
 * pass has run `HISTORY_RETENTION_MAX_BATCHES` of them; a backlog the cap
 * leaves (a year of history on a server's first start with a window)
 * clears over the next passes, oldest first. Each batch is its own
 * statement, so a pass holds no long transaction. The store removes oldest
 * first by time, so an organization's kept entries stay one unbroken run
 * (store.ts, "Retention").
 *
 * Two replicas that overlap remove the same rows at most once between
 * them: each batch deletes only rows that still exist, so no lease is
 * kept. A fault is logged and ends the pass; the next pass tries again. A
 * pass that removed anything logs one line, its count and whether it
 * stopped at the cap; one that removed nothing logs nothing.
 *
 * What the tests pin (__tests__/history-retention.test.ts): the cutoff,
 * the batches and the cap, the log lines, a fault never thrown, start and
 * stop, and a stop between batches ending the pass.
 */
import type { Logger } from "../../boot/logger.js";
import type { GrantStore } from "./store.js";

/** How often a pass runs; a window counted in days needs no finer grain. */
export const HISTORY_RETENTION_PASS_INTERVAL_MS = 60 * 60 * 1000;

/** The most entries one statement removes. */
export const HISTORY_RETENTION_BATCH = 1000;

/** The most statements one pass runs: at most 100,000 entries a pass. */
export const HISTORY_RETENTION_MAX_BATCHES = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AccessHistoryRetentionRunnerDeps {
  /** The composed grant store: the history it keeps is the one aged out. */
  readonly grants: Pick<GrantStore, "pruneChanges">;
  /** The declared window, a positive whole number of days. */
  readonly retentionDays: number;
  readonly logger: Logger;
  /** The clock; tests pass their own. */
  readonly now?: () => Date;
  /** The interval between passes; tests pass their own. */
  readonly intervalMs?: number;
}

export class AccessHistoryRetentionRunner {
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | undefined;
  private pass: Promise<void> | undefined;
  private stopped = false;

  constructor(private readonly deps: AccessHistoryRetentionRunnerDeps) {
    if (!Number.isSafeInteger(deps.retentionDays) || deps.retentionDays < 1) {
      throw new Error(
        `access history retention must be a positive number of days, got ${deps.retentionDays}`,
      );
    }
    this.now = deps.now ?? (() => new Date());
  }

  /** Starts the interval and runs a first pass at once. */
  start(): void {
    if (this.timer !== undefined || this.stopped) {
      return;
    }
    this.timer = setInterval(
      () => this.schedulePass(),
      this.deps.intervalMs ?? HISTORY_RETENTION_PASS_INTERVAL_MS,
    );
    this.timer.unref();
    this.schedulePass();
  }

  /** Stops the interval and waits for a pass in flight, which ends before its next batch. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.pass;
  }

  /** A pass, unless one is still running: the next interval catches up. */
  private schedulePass(): void {
    if (this.pass !== undefined) {
      return;
    }
    this.pass = this.runPass().finally(() => {
      this.pass = undefined;
    });
  }

  /** One pass: removes the entries older than the window, a batch at a time. Never throws. */
  async runPass(): Promise<void> {
    const cutoff = new Date(this.now().getTime() - this.deps.retentionDays * DAY_MS);
    let removed = 0;
    // A full last batch means older entries may remain: the cap or a stop
    // ended the pass, and the next one goes on.
    let more = false;
    try {
      for (let batch = 0; batch < HISTORY_RETENTION_MAX_BATCHES && !this.stopped; batch++) {
        const count = await this.deps.grants.pruneChanges(cutoff, HISTORY_RETENTION_BATCH);
        removed += count;
        more = count === HISTORY_RETENTION_BATCH;
        if (!more) {
          break;
        }
      }
    } catch (error) {
      this.deps.logger.warn("access history retention pass failed; the next pass retries", {
        error: error instanceof Error ? error.message : String(error),
        removed,
        cutoff: cutoff.toISOString(),
      });
      return;
    }
    if (removed > 0) {
      this.deps.logger.info("access history entries older than the retention window removed", {
        removed,
        retentionDays: this.deps.retentionDays,
        cutoff: cutoff.toISOString(),
        more,
      });
    }
  }
}

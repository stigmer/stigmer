/**
 * Pins the access-history retention runner (../history-retention.ts) over
 * a recording store: the runner's only collaborator is the port's
 * `pruneChanges`, so the arms read back what it was asked and what it
 * logged. The removal itself, over real stores, is the port kit's and the
 * Store kit's; the composed proof is Enterprise's
 * enterprise-access-history-retention.postgres.test.ts.
 *
 * What it pins:
 *   - the cutoff is the clock less the window, the same for every batch of
 *     a pass;
 *   - batches run until one comes back short, and stop at the cap, which
 *     the log line reports as more to remove;
 *   - a pass that removes nothing logs nothing; a fault is logged with
 *     what was removed before it, never thrown;
 *   - start runs a pass at once and is a no-op the second time; the
 *     interval runs more passes, but never a second beside one in flight;
 *     stop waits for the pass in flight, which ends before its next batch;
 *   - a window that is not a positive whole number of days refuses to
 *     construct.
 */
import { describe, expect, it } from "vitest";

import type { Logger } from "../../../boot/logger.js";
import {
  AccessHistoryRetentionRunner,
  HISTORY_RETENTION_BATCH,
  HISTORY_RETENTION_MAX_BATCHES,
} from "../history-retention.js";

const NOW = new Date("2026-10-14T12:00:00.000Z");

interface Logged {
  readonly level: "info" | "warn";
  readonly message: string;
  readonly fields: Record<string, unknown> | undefined;
}

function recordingLogger(logged: Logged[]): Logger {
  return {
    debug() {},
    info(message, fields) {
      logged.push({ level: "info", message, fields });
    },
    warn(message, fields) {
      logged.push({ level: "warn", message, fields });
    },
    error() {},
  };
}

/** A store that answers each call from the list, then 0, recording the cutoffs and limits. */
function recordingStore(answers: ReadonlyArray<number | Error>): {
  readonly calls: Array<{ readonly before: string; readonly limit: number }>;
  pruneChanges(before: Date, limit: number): Promise<number>;
} {
  const calls: Array<{ readonly before: string; readonly limit: number }> = [];
  return {
    calls,
    pruneChanges(before, limit) {
      calls.push({ before: before.toISOString(), limit });
      const answer = answers[calls.length - 1] ?? 0;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
}

function runner(
  policies: ReturnType<typeof recordingStore>,
  logged: Logged[],
  options: { readonly retentionDays?: number; readonly intervalMs?: number } = {},
): AccessHistoryRetentionRunner {
  return new AccessHistoryRetentionRunner({
    policies,
    retentionDays: options.retentionDays ?? 30,
    logger: recordingLogger(logged),
    now: () => NOW,
    intervalMs: options.intervalMs,
  });
}

describe("a retention pass", () => {
  it("removes the entries older than the window a batch at a time until a batch comes back short", async () => {
    const logged: Logged[] = [];
    const store = recordingStore([HISTORY_RETENTION_BATCH, HISTORY_RETENTION_BATCH, 7]);
    await runner(store, logged, { retentionDays: 30 }).runPass();

    expect(store.calls).toEqual(
      Array.from({ length: 3 }, () => ({
        before: "2026-09-14T12:00:00.000Z",
        limit: HISTORY_RETENTION_BATCH,
      })),
    );
    expect(logged).toEqual([
      {
        level: "info",
        message: "access history entries older than the retention window removed",
        fields: {
          removed: 2 * HISTORY_RETENTION_BATCH + 7,
          retentionDays: 30,
          cutoff: "2026-09-14T12:00:00.000Z",
          more: false,
        },
      },
    ]);
  });

  it("stops at the cap and says more remain", async () => {
    const logged: Logged[] = [];
    const store = recordingStore(
      Array.from({ length: HISTORY_RETENTION_MAX_BATCHES + 5 }, () => HISTORY_RETENTION_BATCH),
    );
    await runner(store, logged).runPass();

    expect(store.calls).toHaveLength(HISTORY_RETENTION_MAX_BATCHES);
    expect(logged).toEqual([
      expect.objectContaining({
        level: "info",
        fields: expect.objectContaining({
          removed: HISTORY_RETENTION_MAX_BATCHES * HISTORY_RETENTION_BATCH,
          more: true,
        }),
      }),
    ]);
  });

  it("logs nothing when nothing is older than the window", async () => {
    const logged: Logged[] = [];
    const store = recordingStore([0]);
    await runner(store, logged).runPass();
    expect(store.calls).toHaveLength(1);
    expect(logged).toEqual([]);
  });

  it("logs a fault with what it removed before it, and never throws", async () => {
    const logged: Logged[] = [];
    const store = recordingStore([HISTORY_RETENTION_BATCH, new Error("connection reset by peer")]);
    await expect(runner(store, logged).runPass()).resolves.toBeUndefined();
    expect(logged).toEqual([
      {
        level: "warn",
        message: "access history retention pass failed; the next pass retries",
        fields: {
          error: "connection reset by peer",
          removed: HISTORY_RETENTION_BATCH,
          cutoff: "2026-09-14T12:00:00.000Z",
        },
      },
    ]);
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses a window of %s days", (retentionDays) => {
    expect(() => runner(recordingStore([]), [], { retentionDays })).toThrowError(
      `access history retention must be a positive number of days, got ${retentionDays}`,
    );
  });
});

describe("the runner's loop", () => {
  it("runs a pass at once on start, ignores a second start, and runs again on the interval", async () => {
    const store = recordingStore([]);
    const loop = runner(store, [], { intervalMs: 5 });
    loop.start();
    loop.start();
    expect(store.calls).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    await loop.stop();
    const passes = store.calls.length;
    expect(passes).toBeGreaterThan(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.calls).toHaveLength(passes);
  });

  it("starts no second pass on the interval while one is still running", async () => {
    let release: (count: number) => void = () => {};
    let calls = 0;
    const loop = new AccessHistoryRetentionRunner({
      policies: {
        pruneChanges: () => {
          calls += 1;
          return new Promise<number>((resolve) => {
            release = resolve;
          });
        },
      },
      retentionDays: 30,
      logger: recordingLogger([]),
      now: () => NOW,
      intervalMs: 5,
    });
    loop.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(calls).toBe(1);
    release(0);
    await loop.stop();
  });

  it("stop waits for the pass in flight, which ends before its next batch", async () => {
    let release: (count: number) => void = () => {};
    const calls: number[] = [];
    const loop = new AccessHistoryRetentionRunner({
      policies: {
        pruneChanges: () => {
          calls.push(calls.length);
          return new Promise<number>((resolve) => {
            release = resolve;
          });
        },
      },
      retentionDays: 30,
      logger: recordingLogger([]),
      now: () => NOW,
    });
    loop.start();
    let stopped = false;
    const stopping = loop.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release(HISTORY_RETENTION_BATCH);
    await stopping;
    expect(calls).toHaveLength(1);
    loop.start();
    expect(calls).toHaveLength(1);
  });
});

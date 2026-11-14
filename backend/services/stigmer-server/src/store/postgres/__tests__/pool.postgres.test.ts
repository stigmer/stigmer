/**
 * Pins the failure stigmer/stigmer#3086 names, on a real database: a pool
 * whose every connection is held turns the next request into one that
 * never answers. Through the store a held connection is a transaction
 * waiting on a lock, which is what a slow write during a burst looks like;
 * here a test holds the one connection of a pool of one directly. The next
 * query must fail within the checkout deadline with
 * `DatabaseUnavailableError` (whose counters say the pool was full: total
 * equals max), the waiting gauge must read the queued request meanwhile,
 * and once the connection is released the same pool must serve again. The
 * store is pinned to the same posture through `PostgresStore.open`'s pool
 * options.
 *
 * Gated on TEST_DATABASE_URL (support.ts): visible skips without a
 * database, always exercised in CI via the ci.stigmer-server service
 * container.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseUnavailableError } from "../../interface.js";
import { newBoundedPool } from "../pool.js";
import { PostgresStore } from "../store.js";
import { createTestDatabase, testDatabaseAdminUrl, type TestDatabase } from "./support.js";

/** Short enough to keep the suite fast, long enough to read the queue. */
const CHECKOUT_TIMEOUT_MS = 300;

describe.skipIf(testDatabaseAdminUrl() === undefined)("a bounded pool with every connection held", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.drop();
  });

  it("fails the next query within the deadline as DatabaseUnavailableError, and serves once released", async () => {
    const pool = newBoundedPool({
      connectionString: db.databaseUrl,
      max: 1,
      checkoutTimeoutMs: CHECKOUT_TIMEOUT_MS,
      onIdleError: () => {},
    });
    try {
      const held = await pool.connect();
      const startedAt = Date.now();
      const starved = pool.query("SELECT 1").then(
        () => undefined,
        (error: unknown) => error,
      );
      // The starved query is queued for the one connection.
      expect(pool.stats()).toMatchObject({ max: 1, total: 1, idle: 0, waiting: 1 });

      const failure = await starved;
      const waitedMs = Date.now() - startedAt;
      expect(failure).toBeInstanceOf(DatabaseUnavailableError);
      expect((failure as Error).message).toContain("max 1, total 1, idle 0");
      expect(waitedMs).toBeGreaterThanOrEqual(CHECKOUT_TIMEOUT_MS - 50);
      expect(waitedMs).toBeLessThan(CHECKOUT_TIMEOUT_MS + 2_000);
      expect(pool.stats()).toMatchObject({ waiting: 0, checkoutFailures: 1 });

      held.release();
      const served = await pool.query<{ one: number }>("SELECT 1 AS one");
      expect(served.rows).toEqual([{ one: 1 }]);
    } finally {
      await pool.end();
    }
  });

  it("is the store's pool: its bounds come from the open options and its stats from poolStats", async () => {
    const store = await PostgresStore.open(db.databaseUrl, undefined, {
      poolMax: 2,
      poolCheckoutTimeoutMs: CHECKOUT_TIMEOUT_MS,
    });
    try {
      expect(store.poolStats()).toMatchObject({ max: 2, waiting: 0, checkoutFailures: 0 });
    } finally {
      await store.close();
    }
    expect(store.poolStats()).toEqual({ max: 0, total: 0, idle: 0, waiting: 0, checkoutFailures: 0 });
  });
});

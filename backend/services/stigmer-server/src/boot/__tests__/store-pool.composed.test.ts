/**
 * Pins stigmer/stigmer#3086 through a composed server on Postgres: a
 * server whose pool cannot hand out a connection answers the next RPC
 * Unavailable within its checkout deadline instead of hanging, keeps its
 * authored copy, and serves again once the connection is free; and the
 * pool's gauges (observability/store-pool-metrics.ts) are read from the
 * live pool while it serves. That they stop when the observer is removed
 * is store-pool-metrics.test.ts's; the drain removes it here.
 *
 * The starvation is real, not simulated: the server runs with
 * DATABASE_POOL_MAX=1, a session of the test's own holds an ACCESS
 * EXCLUSIVE lock on every table of the server's database, so the first
 * read holds the server's one connection waiting on the lock (a slow write
 * during a burst, in miniature), and the second read finds the pool full.
 *
 * Gated on TEST_DATABASE_URL (store/postgres/__tests__/support.ts).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { silentLogger, baseConfig, transportFor } from "../../extensions/__tests__/composed-support.js";
import { inMemoryMeter, until, type InMemoryMeter } from "../../observability/__tests__/in-memory-meter.js";
import {
  STORE_POOL_CHECKOUT_FAILURES,
  STORE_POOL_CONNECTIONS,
  resetStorePoolMetrics,
} from "../../observability/store-pool-metrics.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
  type TestDatabase,
} from "../../store/postgres/__tests__/support.js";
import { composeServer, type ComposedServer } from "../compose.js";
import { loadConfig } from "../config.js";

const CHECKOUT_TIMEOUT_MS = 400;

async function failureOf(call: Promise<unknown>): Promise<ConnectError | undefined> {
  try {
    await call;
    return undefined;
  } catch (error) {
    return ConnectError.from(error);
  }
}

describe.skipIf(testDatabaseAdminUrl() === undefined)("a composed server whose store pool is starved", () => {
  let db: TestDatabase;
  let dir: string;
  let meter: InMemoryMeter;
  let server: ComposedServer | undefined;
  let port: number;

  beforeAll(async () => {
    db = await createTestDatabase();
    dir = mkdtempSync(path.join(tmpdir(), "store-pool-"));
    meter = await inMemoryMeter(resetStorePoolMetrics);
    server = await composeServer({
      config: loadConfig({
        ...baseConfig(dir),
        DATABASE_URL: db.databaseUrl,
        DATABASE_POOL_MAX: "1",
        DATABASE_POOL_CHECKOUT_TIMEOUT_MS: String(CHECKOUT_TIMEOUT_MS),
      }),
      logger: silentLogger,
      portOverride: 0,
    });
    port = await server.start();
  });

  afterAll(async () => {
    await server?.shutdown();
    await meter.dispose();
    rmSync(dir, { recursive: true, force: true });
    await db.drop();
  });

  it("answers Unavailable within the deadline while the one connection is held, then serves", async () => {
    const organizations = createClient(OrganizationQueryController, transportFor(port));
    const locker = new pg.Client({ connectionString: db.databaseUrl });
    await locker.connect();
    let held: Promise<ConnectError | undefined> | undefined;
    try {
      const tables = await locker.query<{ name: string }>(
        "SELECT quote_ident(tablename) AS name FROM pg_tables WHERE schemaname = 'public'",
      );
      await locker.query("BEGIN");
      await locker.query(`LOCK TABLE ${tables.rows.map((row) => row.name).join(", ")} IN ACCESS EXCLUSIVE MODE`);

      // The first read takes the pool's one connection and waits on the lock.
      held = failureOf(organizations.get({ value: "org_absent" }));
      await until(
        async () =>
          (
            await locker.query<{ waiting: number }>(
              "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
            )
          ).rows[0]?.waiting ?? 0,
        (waiting) => waiting > 0,
      );

      const startedAt = Date.now();
      const starved = await failureOf(organizations.get({ value: "org_absent" }));
      const waitedMs = Date.now() - startedAt;
      expect(starved?.code).toBe(Code.Unavailable);
      expect(starved?.rawMessage).not.toContain("pool");
      expect(waitedMs).toBeLessThan(CHECKOUT_TIMEOUT_MS + 2_000);

      const collected = await meter.collect();
      const connections = Object.fromEntries(
        (collected.get(STORE_POOL_CONNECTIONS) ?? []).map((point) => [point.attributes["state"], point.value]),
      );
      expect(connections).toEqual({ total: 1, idle: 0, waiting: 0 });
      const failures = collected.get(STORE_POOL_CHECKOUT_FAILURES)?.[0]?.value;
      expect(failures).toBeGreaterThanOrEqual(1);
    } finally {
      await locker.query("ROLLBACK");
      await locker.end();
      await held;
    }

    // Free again: the same read is served (the organization is absent).
    const served = await failureOf(organizations.get({ value: "org_absent" }));
    expect(served?.code).toBe(Code.NotFound);
  });
});

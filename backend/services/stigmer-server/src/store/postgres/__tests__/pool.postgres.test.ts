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
 * options, and its idle-connection error is a WARN, driven for real by
 * terminating the store's idle backend.
 *
 * The boot's first connection is pinned against the failure
 * stigmer/stigmer#3403 names: a database that is up but does not answer a
 * new pod for its first seconds (its NetworkPolicy admitting the pod late).
 * A stand-in in front of the real database accepts connections and stays
 * silent for a while, so pg's own timeout fires ("Connection terminated due
 * to connection timeout"), then passes traffic through: the store must open
 * after logged retries instead of failing its boot. A missing database is
 * Postgres's own answer and must fail at once, with no retry.
 *
 * Gated on TEST_DATABASE_URL (support.ts): visible skips without a
 * database, always exercised in CI via the ci.stigmer-server service
 * container.
 */
import { connect as connectTcp, createServer } from "node:net";
import type { AddressInfo, Server, Socket } from "node:net";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseUnavailableError } from "../../interface.js";
import type { StoreLogger } from "../../logger.js";
import { newBoundedPool } from "../pool.js";
import { PostgresStore } from "../store.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
  type TestDatabase,
} from "./support.js";

/** Short enough to keep the suite fast, long enough to read the queue. */
const CHECKOUT_TIMEOUT_MS = 300;

describe.skipIf(testDatabaseAdminUrl() === undefined)(
  "a bounded pool with every connection held",
  () => {
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
        expect(pool.stats()).toMatchObject({
          max: 1,
          total: 1,
          idle: 0,
          waiting: 1,
        });

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
        expect(store.poolStats()).toMatchObject({
          max: 2,
          waiting: 0,
          checkoutFailures: 0,
        });
      } finally {
        await store.close();
      }
      expect(store.poolStats()).toEqual({
        max: 0,
        total: 0,
        idle: 0,
        waiting: 0,
        checkoutFailures: 0,
      });
    });

    it("logs each terminated idle connection as a WARN and keeps serving", async () => {
      const warns: Array<{
        message: string;
        fields?: Record<string, unknown>;
      }> = [];
      const logger: StoreLogger = {
        debug() {},
        info() {},
        warn(message, fields) {
          warns.push({ message, fields });
        },
      };
      const store = await PostgresStore.open(db.databaseUrl, logger);
      const admin = new pg.Client({ connectionString: db.databaseUrl });
      await admin.connect();
      try {
        // The migration client went back to the pool idle at open.
        expect(store.poolStats().idle).toBeGreaterThan(0);
        await admin.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()",
        );
        const deadline = Date.now() + 5_000;
        while (warns.length === 0 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(warns.length).toBeGreaterThan(0);
        for (const warn of warns) {
          expect(warn.message).toBe("postgres pool idle-connection error");
          expect(typeof warn.fields?.["error"]).toBe("string");
        }
        expect(await store.bootstrapState.get("absent-key")).toBe("");
      } finally {
        await admin.end();
        await store.close();
      }
    });
  },
);

interface SilentFront {
  /** `databaseUrl` pointed at the stand-in. */
  readonly url: string;
  close(): Promise<void>;
}

/**
 * A TCP stand-in in front of `databaseUrl`: a connection made in its first
 * `silentMs` is accepted and never answered, the way a dropped packet looks
 * to the client once the handshake is done; later ones are piped through.
 */
async function silentFront(databaseUrl: string, silentMs: number): Promise<SilentFront> {
  const target = new URL(databaseUrl);
  const targetPort = target.port === "" ? 5432 : Number(target.port);
  const silentUntil = Date.now() + silentMs;
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    if (Date.now() < silentUntil) {
      return;
    }
    const upstream = connectTcp(targetPort, target.hostname);
    sockets.add(upstream);
    upstream.on("close", () => sockets.delete(upstream));
    upstream.on("error", () => socket.destroy());
    socket.on("close", () => upstream.destroy());
    upstream.on("close", () => socket.destroy());
    socket.pipe(upstream).pipe(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const front = new URL(databaseUrl);
  front.hostname = "127.0.0.1";
  front.port = String((server.address() as AddressInfo).port);
  return {
    url: front.toString(),
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe.skipIf(testDatabaseAdminUrl() === undefined)(
  "the store's first connection",
  () => {
    let db: TestDatabase;

    beforeAll(async () => {
      db = await createTestDatabase();
    });

    afterAll(async () => {
      await db.drop();
    });

    it("opens once a database that stays silent at first answers, logging each retry", async () => {
      const lines: Array<{ level: string; message: string; fields?: Record<string, unknown> }> = [];
      const logger: StoreLogger = {
        debug() {},
        info(message, fields) {
          lines.push({ level: "info", message, fields });
        },
        warn(message, fields) {
          lines.push({ level: "warn", message, fields });
        },
      };
      const front = await silentFront(db.databaseUrl, 1_500);
      try {
        const store = await PostgresStore.open(front.url, logger, {
          poolCheckoutTimeoutMs: CHECKOUT_TIMEOUT_MS,
          firstConnectionWaitMs: 15_000,
        });
        try {
          expect(await store.bootstrapState.get("absent-key")).toBe("");
        } finally {
          await store.close();
        }
      } finally {
        await front.close();
      }
      const retries = lines.filter(
        (line) => line.message === "the database is not answering yet; retrying",
      );
      expect(retries.length).toBeGreaterThan(0);
      expect(retries[0]?.level).toBe("warn");
      expect(String(retries[0]?.fields?.["error"])).toContain(
        "Connection terminated due to connection timeout",
      );
      expect(lines).toContainEqual(
        expect.objectContaining({ level: "info", message: "the database answered" }),
      );
    });

    it("fails at once, without a retry, on a database that does not exist", async () => {
      const missing = new URL(db.databaseUrl);
      missing.pathname = `${missing.pathname}_absent`;
      const warns: string[] = [];
      const logger: StoreLogger = {
        debug() {},
        info() {},
        warn(message) {
          warns.push(message);
        },
      };
      const startedAt = Date.now();
      const failure: unknown = await PostgresStore.open(missing.toString(), logger, {
        firstConnectionWaitMs: 15_000,
      }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(DatabaseUnavailableError);
      expect((failure as DatabaseUnavailableError).cause).toBeInstanceOf(pg.DatabaseError);
      expect(warns).toEqual([]);
      expect(Date.now() - startedAt).toBeLessThan(5_000);
    });
  },
);

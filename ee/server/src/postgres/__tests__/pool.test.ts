/**
 * Pins the crash class a composition pool closes and the posture that
 * closes it. A `pg.Pool` re-emits an idle client's error as its own
 * `'error'` event; Node's EventEmitter turns an unlistened `'error'` emit
 * into a synchronous throw, which on the event loop is a process exit. The
 * first test shows the class on a bare pool so the file
 * says what it protects against; the second shows a composition pool
 * absorbing the same emit into exactly one WARN that names the pool and
 * carries the message. A last case pins that every composition pool
 * carries the checkout deadline, which bounds a starved checkout instead
 * of letting it wait forever, and is `@stigmer/server`'s bounded pool: the
 * same deadline constant, the same size unless its composition passes its
 * own (as the self-hosted server passes the operator's), and a checkout
 * that cannot open a
 * connection rejects with `DatabaseUnavailableError`, which every RPC
 * answers as Unavailable (stigmer/stigmer#3086). The starved checkout
 * itself is proven on a real database in the server's
 * store/postgres/__tests__/pool.postgres.test.ts. No database is involved: `emit` is how pg-pool itself reports the idle
 * client's error, so driving the emitter is driving the real path. A pool
 * that never connected ends cleanly, so each test closes what it opened.
 */
import {
  BoundedPool,
  DEFAULT_POOL_CHECKOUT_TIMEOUT_MS,
  DEFAULT_POOL_MAX,
  DatabaseUnavailableError,
  createLogger,
} from "@stigmer/server";
import pg from "pg";
import { describe, expect, it } from "vitest";

import { POOL_CHECKOUT_TIMEOUT_MS, newCompositionPool } from "../pool.js";

interface LogLine {
  readonly level: string;
  readonly message: string;
  readonly [field: string]: unknown;
}

function logCapture(): {
  logger: ReturnType<typeof createLogger>;
  lines: () => LogLine[];
} {
  const raw: string[] = [];
  const logger = createLogger({
    level: "info",
    pretty: false,
    write: (line: string) => {
      raw.push(line);
    },
  });
  return {
    logger,
    lines: () => raw.map((line) => JSON.parse(line) as LogLine),
  };
}

const CONNECTION_STRING = "postgres://nobody@localhost:1/never-connected";

describe("a composition pool and the idle-connection error", () => {
  it("a bare pg.Pool turns the pool's own 'error' emit into a throw (the crash class)", async () => {
    const bare = new pg.Pool({ connectionString: CONNECTION_STRING });
    try {
      expect(() =>
        bare.emit(
          "error",
          new Error("terminating connection due to administrator command"),
        ),
      ).toThrow("terminating connection due to administrator command");
    } finally {
      await bare.end();
    }
  });

  it("a composition pool absorbs the emit into one WARN naming the pool and the message", async () => {
    const { logger, lines } = logCapture();
    const pool = newCompositionPool({
      name: "iam",
      connectionString: CONNECTION_STRING,
      logger,
    });
    try {
      expect(() =>
        pool.emit(
          "error",
          new Error("terminating connection due to administrator command"),
        ),
      ).not.toThrow();

      const warns = lines().filter((line) => line.level === "warn");
      expect(warns).toHaveLength(1);
      expect(warns[0]).toMatchObject({
        message: "postgres pool idle-connection error",
        pool: "iam",
        error: "terminating connection due to administrator command",
      });
    } finally {
      await pool.end();
    }
  });

  it("stays quiet when nothing goes wrong: construction alone logs nothing", async () => {
    const { logger, lines } = logCapture();
    const pool = newCompositionPool({
      name: "enterprise",
      connectionString: CONNECTION_STRING,
      logger,
    });
    try {
      expect(lines()).toEqual([]);
    } finally {
      await pool.end();
    }
  });
});

describe("a composition pool and a starved checkout", () => {
  it("carries the checkout deadline, so a starved checkout fails instead of waiting forever", async () => {
    const pool = newCompositionPool({
      name: "iam",
      connectionString: CONNECTION_STRING,
      logger: logCapture().logger,
    });
    try {
      expect(pool.options.connectionTimeoutMillis).toBe(POOL_CHECKOUT_TIMEOUT_MS);
    } finally {
      await pool.end();
    }
  });
});

describe("a composition pool is the server's bounded pool", () => {
  it("shares the store's deadline and size", async () => {
    const pool = newCompositionPool({
      name: "enterprise",
      connectionString: CONNECTION_STRING,
      logger: logCapture().logger,
    });
    try {
      expect(pool).toBeInstanceOf(BoundedPool);
      expect(POOL_CHECKOUT_TIMEOUT_MS).toBe(DEFAULT_POOL_CHECKOUT_TIMEOUT_MS);
      expect(pool.options.max).toBe(DEFAULT_POOL_MAX);
    } finally {
      await pool.end();
    }
  });

  it("takes the size and deadline its composition passes", async () => {
    const pool = newCompositionPool({
      name: "enterprise",
      connectionString: CONNECTION_STRING,
      logger: logCapture().logger,
      max: 7,
      checkoutTimeoutMs: 1_500,
    });
    try {
      expect(pool.options.max).toBe(7);
      expect(pool.options.connectionTimeoutMillis).toBe(1_500);
    } finally {
      await pool.end();
    }
  });

  it("rejects a checkout it cannot open with DatabaseUnavailableError", async () => {
    const pool = newCompositionPool({
      name: "enterprise",
      connectionString: CONNECTION_STRING,
      logger: logCapture().logger,
    });
    try {
      await expect(pool.query("SELECT 1")).rejects.toBeInstanceOf(DatabaseUnavailableError);
    } finally {
      await pool.end();
    }
  });
});

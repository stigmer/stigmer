/**
 * Pins the bounded pool's posture with no database (../pool.ts): its
 * defaults and overrides reach pg, an idle client's error goes to the
 * caller's listener instead of crashing the process, and a checkout that
 * cannot open a connection (a port nothing listens on, a real failed open
 * through pg's own path) rejects with `DatabaseUnavailableError` in both
 * of pg's checkout forms, carrying the driver's error as its cause and the
 * pool's counters in its message, and is counted.
 *
 * The boot's first connection (`firstConnection`) is pinned on a fake clock:
 * it retries a failed open with a doubling, capped pause until its wait is
 * spent, logs each retry, and then rejects naming the wait; it returns the
 * client once the database answers and says so; Postgres's "starting up"
 * (57P03) is retried; any other answer from Postgres, and any error that is
 * not a failed checkout, is thrown on the first attempt. The starved-pool
 * case and a database that answers only after a silence need a real
 * database: pool.postgres.test.ts.
 */
import pg from "pg";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import { DatabaseUnavailableError } from "../../interface.js";
import type { StoreLogger } from "../../logger.js";
import {
  DEFAULT_FIRST_CONNECTION_WAIT_MS,
  DEFAULT_POOL_CHECKOUT_TIMEOUT_MS,
  DEFAULT_POOL_MAX,
  firstConnection,
  newBoundedPool,
} from "../pool.js";
import type { FirstConnectionPool } from "../pool.js";

/** Port 1 on loopback: nothing listens, so every open is refused at once. */
const UNREACHABLE = "postgres://nobody@127.0.0.1:1/never-connected";

describe("a bounded pool's bounds", () => {
  it("defaults to 20 connections and a ten-second checkout deadline", async () => {
    const pool = newBoundedPool({
      connectionString: UNREACHABLE,
      onIdleError: () => {},
    });
    try {
      expect(DEFAULT_POOL_MAX).toBe(20);
      expect(DEFAULT_POOL_CHECKOUT_TIMEOUT_MS).toBe(10_000);
      expect(pool.options.max).toBe(DEFAULT_POOL_MAX);
      expect(pool.options.connectionTimeoutMillis).toBe(
        DEFAULT_POOL_CHECKOUT_TIMEOUT_MS,
      );
      expect(pool.stats()).toEqual({
        max: 20,
        total: 0,
        idle: 0,
        waiting: 0,
        checkoutFailures: 0,
      });
    } finally {
      await pool.end();
    }
  });

  it("takes the operator's size and deadline", async () => {
    const pool = newBoundedPool({
      connectionString: UNREACHABLE,
      max: 3,
      checkoutTimeoutMs: 250,
      onIdleError: () => {},
    });
    try {
      expect(pool.options.max).toBe(3);
      expect(pool.options.connectionTimeoutMillis).toBe(250);
    } finally {
      await pool.end();
    }
  });
});

describe("a bounded pool and an idle client's error", () => {
  it("hands the pool's own 'error' emit to the listener instead of throwing", async () => {
    const seen: string[] = [];
    const pool = newBoundedPool({
      connectionString: UNREACHABLE,
      onIdleError: (error) => seen.push(error.message),
    });
    try {
      expect(() =>
        pool.emit(
          "error",
          new Error("terminating connection due to administrator command"),
        ),
      ).not.toThrow();
      expect(seen).toEqual([
        "terminating connection due to administrator command",
      ]);
    } finally {
      await pool.end();
    }
  });
});

describe("a bounded pool that cannot open a connection", () => {
  it("rejects a query with DatabaseUnavailableError carrying the driver's error and the pool's counters", async () => {
    const pool = newBoundedPool({
      connectionString: UNREACHABLE,
      max: 4,
      onIdleError: () => {},
    });
    try {
      const failure: unknown = await pool.query("SELECT 1").then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(DatabaseUnavailableError);
      const error = failure as DatabaseUnavailableError;
      expect(error.cause).toBeInstanceOf(Error);
      expect(error.cause).not.toBeInstanceOf(DatabaseUnavailableError);
      // A failed open leaves no client behind: total below max says it was
      // not a full pool.
      expect(error.message).toContain("max 4, total 0, idle 0, waiting 0");
      expect(error.message).toContain((error.cause as Error).message);
      expect(pool.stats().checkoutFailures).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it("rejects connect() the same way, and reports it through the callback form", async () => {
    const pool = newBoundedPool({
      connectionString: UNREACHABLE,
      onIdleError: () => {},
    });
    try {
      await expect(pool.connect()).rejects.toBeInstanceOf(
        DatabaseUnavailableError,
      );
      const viaCallback = await new Promise<unknown>((resolve) => {
        pool.connect((error, client) => {
          expect(client).toBeUndefined();
          resolve(error);
        });
      });
      expect(viaCallback).toBeInstanceOf(DatabaseUnavailableError);
      expect(pool.stats().checkoutFailures).toBe(2);
    } finally {
      await pool.end();
    }
  });
});

interface LoggedLine {
  readonly level: "info" | "warn";
  readonly message: string;
  readonly fields?: Record<string, unknown>;
}

/** A logger that keeps what it is told, and a clock that moves only when the wait sleeps. */
function recorder(): {
  logger: StoreLogger;
  lines: LoggedLine[];
  sleeps: number[];
  now: () => number;
  sleep: (ms: number) => Promise<void>;
} {
  const lines: LoggedLine[] = [];
  const sleeps: number[] = [];
  let clock = 0;
  return {
    lines,
    sleeps,
    logger: {
      debug() {},
      info(message, fields) {
        lines.push({ level: "info", message, fields });
      },
      warn(message, fields) {
        lines.push({ level: "warn", message, fields });
      },
    },
    now: () => clock,
    sleep: (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
  };
}

/** A failed checkout as the pool reports it, around the driver's `cause`. */
function checkoutFailure(cause: Error): DatabaseUnavailableError {
  return new DatabaseUnavailableError(
    `the connection pool could not hand out a connection: ${cause.message}`,
    { cause },
  );
}

/** Postgres's own answer to a connection, as pg raises it. */
function postgresAnswer(code: string, message: string): pg.DatabaseError {
  const error = new pg.DatabaseError(message, message.length, "error");
  error.code = code;
  return error;
}

/** A pool that fails with each given error in turn, then hands out `client`. */
function poolFailing(
  failures: ReadonlyArray<Error>,
  client: PoolClient,
): FirstConnectionPool & { readonly attempts: () => number } {
  let attempts = 0;
  return {
    attempts: () => attempts,
    connect: () => {
      const failure = failures[attempts];
      attempts += 1;
      return failure === undefined
        ? Promise.resolve(client)
        : Promise.reject(failure);
    },
  };
}

/** The client a stand-in pool hands out; the wait only passes it through. */
const CLIENT = new pg.Client() as unknown as PoolClient;

describe("the boot's first connection", () => {
  it("waits a minute unless told otherwise", () => {
    expect(DEFAULT_FIRST_CONNECTION_WAIT_MS).toBe(60_000);
  });

  it("retries a failed open with a doubling, capped pause, logging each retry, then rejects naming the wait", async () => {
    const pool = newBoundedPool({
      connectionString: UNREACHABLE,
      onIdleError: () => {},
    });
    const { logger, lines, sleeps, now, sleep } = recorder();
    try {
      const failure: unknown = await firstConnection(pool, {
        waitMs: 20_000,
        logger,
        now,
        sleep,
      }).then(
        () => undefined,
        (error: unknown) => error,
      );
      // 1, 2, 4, then the 5-second cap, and the last pause only as long as
      // the wait has left.
      expect(sleeps).toEqual([1_000, 2_000, 4_000, 5_000, 5_000, 3_000]);
      expect(pool.stats().checkoutFailures).toBe(7);
      expect(failure).toBeInstanceOf(DatabaseUnavailableError);
      const error = failure as DatabaseUnavailableError;
      expect(error.message).toMatch(
        /^database unavailable: no connection after waiting 20 s \(7 attempts\): the connection pool could not hand out a connection/,
      );
      // The driver's own error, not the pool's wrapper, so the wire mapping
      // and the log see what pg said.
      expect(error.cause).toBeInstanceOf(Error);
      expect(error.cause).not.toBeInstanceOf(DatabaseUnavailableError);
      expect(lines.map((line) => line.level)).toEqual([
        "warn",
        "warn",
        "warn",
        "warn",
        "warn",
        "warn",
      ]);
      expect(lines[0]).toMatchObject({
        message: "the database is not answering yet; retrying",
        fields: { attempt: 1, waitedMs: 0, waitLimitMs: 20_000, retryInMs: 1_000 },
      });
      expect(typeof lines[0]?.fields?.["error"]).toBe("string");
    } finally {
      await pool.end();
    }
  });

  it("returns the client once the database answers, and says how long it took", async () => {
    const timeout = new Error("Connection terminated due to connection timeout");
    const pool = poolFailing(
      [checkoutFailure(timeout), checkoutFailure(timeout)],
      CLIENT,
    );
    const { logger, lines, sleeps, now, sleep } = recorder();
    const client = await firstConnection(pool, { logger, now, sleep });
    expect(client).toBe(CLIENT);
    expect(pool.attempts()).toBe(3);
    expect(sleeps).toEqual([1_000, 2_000]);
    expect(lines.at(-1)).toEqual({
      level: "info",
      message: "the database answered",
      fields: { attempts: 3, waitedMs: 3_000 },
    });
  });

  it("logs nothing when the first attempt answers", async () => {
    const pool = poolFailing([], CLIENT);
    const { logger, lines, sleeps, now, sleep } = recorder();
    expect(await firstConnection(pool, { logger, now, sleep })).toBe(CLIENT);
    expect(lines).toEqual([]);
    expect(sleeps).toEqual([]);
  });

  it("retries Postgres saying it is starting up (57P03)", async () => {
    const pool = poolFailing(
      [checkoutFailure(postgresAnswer("57P03", "the database system is starting up"))],
      CLIENT,
    );
    const { logger, now, sleep } = recorder();
    expect(await firstConnection(pool, { logger, now, sleep })).toBe(CLIENT);
    expect(pool.attempts()).toBe(2);
  });

  it.each([
    ["a wrong password", "28P01", 'password authentication failed for user "stigmer"'],
    ["a missing database", "3D000", 'database "stigmer" does not exist'],
  ])("fails at once on %s, which waiting will not change", async (_name, code, message) => {
    const answer = checkoutFailure(postgresAnswer(code, message));
    const pool = poolFailing([answer], CLIENT);
    const { logger, lines, sleeps, now, sleep } = recorder();
    await expect(firstConnection(pool, { logger, now, sleep })).rejects.toBe(answer);
    expect(pool.attempts()).toBe(1);
    expect(sleeps).toEqual([]);
    expect(lines).toEqual([]);
  });

  it("throws an error that is not a failed checkout at once", async () => {
    const bug = new TypeError("not a checkout failure");
    const pool = poolFailing([bug], CLIENT);
    const { logger, sleeps, now, sleep } = recorder();
    await expect(firstConnection(pool, { logger, now, sleep })).rejects.toBe(bug);
    expect(sleeps).toEqual([]);
  });
});

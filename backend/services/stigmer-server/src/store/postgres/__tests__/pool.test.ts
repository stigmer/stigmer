/**
 * Pins the bounded pool's posture with no database (../pool.ts): its
 * defaults and overrides reach pg, an idle client's error goes to the
 * caller's listener instead of crashing the process, and a checkout that
 * cannot open a connection (a port nothing listens on, a real failed open
 * through pg's own path) rejects with `DatabaseUnavailableError` in both
 * of pg's checkout forms, carrying the driver's error as its cause and the
 * pool's counters in its message, and is counted. The starved-pool case
 * needs a real database: pool.postgres.test.ts.
 */
import { describe, expect, it } from "vitest";

import { DatabaseUnavailableError } from "../../interface.js";
import {
  DEFAULT_POOL_CHECKOUT_TIMEOUT_MS,
  DEFAULT_POOL_MAX,
  newBoundedPool,
} from "../pool.js";

/** Port 1 on loopback: nothing listens, so every open is refused at once. */
const UNREACHABLE = "postgres://nobody@127.0.0.1:1/never-connected";

describe("a bounded pool's bounds", () => {
  it("defaults to 20 connections and a ten-second checkout deadline", async () => {
    const pool = newBoundedPool({ connectionString: UNREACHABLE, onIdleError: () => {} });
    try {
      expect(DEFAULT_POOL_MAX).toBe(20);
      expect(DEFAULT_POOL_CHECKOUT_TIMEOUT_MS).toBe(10_000);
      expect(pool.options.max).toBe(DEFAULT_POOL_MAX);
      expect(pool.options.connectionTimeoutMillis).toBe(DEFAULT_POOL_CHECKOUT_TIMEOUT_MS);
      expect(pool.stats()).toEqual({ max: 20, total: 0, idle: 0, waiting: 0, checkoutFailures: 0 });
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
        pool.emit("error", new Error("terminating connection due to administrator command")),
      ).not.toThrow();
      expect(seen).toEqual(["terminating connection due to administrator command"]);
    } finally {
      await pool.end();
    }
  });
});

describe("a bounded pool that cannot open a connection", () => {
  it("rejects a query with DatabaseUnavailableError carrying the driver's error and the pool's counters", async () => {
    const pool = newBoundedPool({ connectionString: UNREACHABLE, max: 4, onIdleError: () => {} });
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
    const pool = newBoundedPool({ connectionString: UNREACHABLE, onIdleError: () => {} });
    try {
      await expect(pool.connect()).rejects.toBeInstanceOf(DatabaseUnavailableError);
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

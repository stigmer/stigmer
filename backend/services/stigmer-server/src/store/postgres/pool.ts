/**
 * The one constructor for a bounded Postgres pool: the store's own pool
 * (store.ts) and every pool a composition owns (Enterprise's
 * `newCompositionPool` builds on it) are made here, so they share one size,
 * one checkout deadline, one idle-error posture and one failure type
 * (stigmer/stigmer#3086).
 *
 * Why a size of 20: every request to a server on Postgres borrows a
 * connection from one pool, and pg's default of 10 let one slow write
 * during a burst queue every other request behind it. 20 doubles that,
 * and three such pools per server (the store's and two a composition
 * owns) are 60 connections, inside a hosted Postgres's 200 beside
 * Temporal's and OpenFGA's own bounded pools. An operator sizes it with
 * DATABASE_POOL_MAX (boot/config.ts); replicas times the size, plus every
 * other pool on the database, must fit its `max_connections`.
 *
 * Why a checkout deadline: pg's default waits for a free client forever,
 * so a pool whose clients are all held turns every later query into a
 * request that never answers, and nothing in the log says why. Ten
 * seconds is far past any healthy wait for a client and well inside a
 * caller's patience. The bound covers waiting for a client and opening a
 * new connection, never how long a client is held, so a long migration or
 * a lock's transaction is untouched.
 *
 * Why every checkout failure is one typed error: pg reports a starved
 * checkout and a failed open (a refused, unreachable or timed-out
 * connection) as bare Errors with no code and different messages
 * (pg-pool's `connect` and `newClient`). Neither is the request's fault,
 * so `connect` turns both into `DatabaseUnavailableError` (../interface.ts),
 * which the wire mapping answers as Unavailable. `pool.query` checks out
 * through `connect`, so the one override covers every query and every
 * transaction. The two cases are told apart by the pool's own counters in
 * the message (a full pool's `total` equals `max`), never by matching pg's
 * text. A query that fails once it holds a client is not a checkout
 * failure and keeps its own error.
 *
 * Why the idle-error listener: a `pg.Pool` re-emits an idle client's error
 * as its own `'error'` event, and an EventEmitter with no `'error'`
 * listener turns that emit into a process crash. The pool has already
 * dropped the dead client by then and the next checkout opens a fresh one,
 * so the caller's listener only reports it.
 *
 * Proven by __tests__/pool.test.ts (a failed open, no database) and
 * __tests__/pool.postgres.test.ts (a starved checkout, under
 * TEST_DATABASE_URL).
 */
import pg from "pg";
import type { PoolClient } from "pg";

import { DatabaseUnavailableError } from "../interface.js";

/** Connections a bounded pool holds unless told otherwise. */
export const DEFAULT_POOL_MAX = 20;

/** How long a checkout waits for a client before it fails instead of hanging. */
export const DEFAULT_POOL_CHECKOUT_TIMEOUT_MS = 10_000;

export interface BoundedPoolOptions {
  readonly connectionString: string;
  /** The most connections the pool holds (DEFAULT_POOL_MAX). */
  readonly max?: number;
  /** How long a checkout may wait, for a free client or a new one (DEFAULT_POOL_CHECKOUT_TIMEOUT_MS). */
  readonly checkoutTimeoutMs?: number;
  /** Told of an idle client's error; the pool has already dropped the client. */
  readonly onIdleError: (error: Error) => void;
}

/** The pool's state, read from its own counters; `checkoutFailures` counts since it was built. */
export interface PoolStats {
  readonly max: number;
  readonly total: number;
  readonly idle: number;
  readonly waiting: number;
  readonly checkoutFailures: number;
}

/** pg's checkout callback, as `@types/pg` declares it for `Pool.connect`. */
type CheckoutCallback = (
  error: Error | undefined,
  client: PoolClient | undefined,
  done: (release?: unknown) => void,
) => void;

/**
 * A `pg.Pool` whose failed checkouts reject with `DatabaseUnavailableError`
 * and which reports its own state. Built by `newBoundedPool` only.
 */
export class BoundedPool extends pg.Pool {
  private readonly checkoutTimeoutMs: number;
  private failures = 0;

  constructor(options: BoundedPoolOptions) {
    const max = options.max ?? DEFAULT_POOL_MAX;
    const checkoutTimeoutMs =
      options.checkoutTimeoutMs ?? DEFAULT_POOL_CHECKOUT_TIMEOUT_MS;
    super({
      connectionString: options.connectionString,
      max,
      connectionTimeoutMillis: checkoutTimeoutMs,
    });
    this.checkoutTimeoutMs = checkoutTimeoutMs;
    this.on("error", options.onIdleError);
  }

  override connect(): Promise<PoolClient>;
  override connect(callback: CheckoutCallback): void;
  override connect(callback?: CheckoutCallback): Promise<PoolClient> | void {
    if (callback === undefined) {
      return super.connect().catch((error: unknown) => {
        throw this.checkoutFailed(error);
      });
    }
    super.connect((error, client, done) => {
      if (error) {
        callback(this.checkoutFailed(error), undefined, done);
        return;
      }
      callback(error, client, done);
    });
  }

  /** The pool's state now. */
  stats(): PoolStats {
    return {
      max: this.options.max,
      total: this.totalCount,
      idle: this.idleCount,
      waiting: this.waitingCount,
      checkoutFailures: this.failures,
    };
  }

  private checkoutFailed(error: unknown): DatabaseUnavailableError {
    this.failures += 1;
    const { max, total, idle, waiting } = this.stats();
    const reason = error instanceof Error ? error.message : String(error);
    return new DatabaseUnavailableError(
      `the connection pool could not hand out a connection ` +
        `(max ${max}, total ${total}, idle ${idle}, waiting ${waiting}, ` +
        `checkout timeout ${this.checkoutTimeoutMs} ms): ${reason}`,
      { cause: error },
    );
  }
}

/** A bounded pool over `connectionString`; see the module header for each bound. */
export function newBoundedPool(options: BoundedPoolOptions): BoundedPool {
  return new BoundedPool(options);
}

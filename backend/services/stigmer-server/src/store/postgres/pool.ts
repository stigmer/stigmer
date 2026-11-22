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
 * Why the first connection waits (`firstConnection`): at boot the database
 * can be up and still not answer this process for a few seconds. On
 * Kubernetes, a brand-new pod's address joins the database's
 * NetworkPolicy allow list asynchronously, so its first packets are
 * dropped (stigmer/stigmer#3403: an arm64 kind node took over ten
 * seconds); under Compose, or beside a database that is still starting,
 * the server can simply be first. Failing the boot on the first refused or
 * timed-out open turns that into a container restart. So the store's first
 * checkout retries, with a doubling pause, for a bounded time
 * (DEFAULT_FIRST_CONNECTION_WAIT_MS, inside the operator's 150-second
 * startup budget), and logs each retry. It retries only what can pass on
 * its own: a failure with no answer from Postgres (a timeout, a refusal, a
 * name that does not resolve yet) or Postgres saying it cannot accept
 * connections yet (SQLSTATE 57P03). Any other answer from Postgres (a
 * wrong password, a missing database) is a setting to fix and fails at
 * once. Only the first connection waits: once the store has opened, a
 * failed checkout is a request's Unavailable, as above.
 *
 * Proven by __tests__/pool.test.ts (a failed open, no database, and the
 * first connection's schedule) and __tests__/pool.postgres.test.ts (a
 * starved checkout, and a database that answers only after a silence,
 * under TEST_DATABASE_URL).
 */
import pg from "pg";
import type { PoolClient } from "pg";

import { DatabaseUnavailableError } from "../interface.js";
import type { StoreLogger } from "../logger.js";

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

/** How long the first connection may keep failing before the boot gives up. */
export const DEFAULT_FIRST_CONNECTION_WAIT_MS = 60_000;

/** The pause after the first failed attempt; it doubles up to the cap. */
const FIRST_CONNECTION_PAUSE_MS = 1_000;
const FIRST_CONNECTION_PAUSE_CAP_MS = 5_000;

/** SQLSTATE cannot_connect_now: Postgres is starting up or recovering. */
const CANNOT_CONNECT_NOW = "57P03";

/** What the first connection needs of a pool: a `BoundedPool`, or a test's stand-in. */
export interface FirstConnectionPool {
  connect(): Promise<PoolClient>;
}

export interface FirstConnectionOptions {
  /** How long failed attempts may go on (DEFAULT_FIRST_CONNECTION_WAIT_MS); the last attempt starts inside it. */
  readonly waitMs?: number;
  /** Told of each retry, and of the answer when it took more than one attempt. */
  readonly logger: StoreLogger;
  /** The pause between attempts; a test passes one that returns at once. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** The clock the wait is measured on; a test passes its own. */
  readonly now?: () => number;
}

/**
 * The pool's first client, waiting a bounded time for a database that does
 * not answer yet (the module header says why and what is retried). Rejects
 * with the last `DatabaseUnavailableError`, naming the wait, once it is
 * spent, or at once for a failure that will not pass on its own.
 */
export async function firstConnection(
  pool: FirstConnectionPool,
  options: FirstConnectionOptions,
): Promise<PoolClient> {
  const waitMs = options.waitMs ?? DEFAULT_FIRST_CONNECTION_WAIT_MS;
  const sleep = options.sleep ?? pause;
  const now = options.now ?? Date.now;
  const started = now();
  let nextPauseMs = FIRST_CONNECTION_PAUSE_MS;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const client = await pool.connect();
      if (attempt > 1) {
        options.logger.info("the database answered", {
          attempts: attempt,
          waitedMs: now() - started,
        });
      }
      return client;
    } catch (error) {
      if (
        !(error instanceof DatabaseUnavailableError) ||
        !passesOnItsOwn(error.cause)
      ) {
        throw error;
      }
      const waitedMs = now() - started;
      if (waitedMs >= waitMs) {
        throw new DatabaseUnavailableError(
          `no connection after waiting ${Math.round(waitedMs / 1000)} s ` +
            `(${attempt} attempts): ${error.detail}`,
          { cause: error.cause },
        );
      }
      const retryInMs = Math.min(nextPauseMs, waitMs - waitedMs);
      options.logger.warn("the database is not answering yet; retrying", {
        attempt,
        waitedMs,
        waitLimitMs: waitMs,
        retryInMs,
        error: error.detail,
      });
      await sleep(retryInMs);
      nextPauseMs = Math.min(nextPauseMs * 2, FIRST_CONNECTION_PAUSE_CAP_MS);
    }
  }
}

/**
 * True for a failed open that a later attempt can get past: no answer from
 * Postgres at all (pg's own timeout, or a socket error such as a refusal or
 * an unresolved name), or Postgres answering that it cannot accept
 * connections yet. Every other answer from Postgres is a `DatabaseError`
 * that waiting will not change.
 */
function passesOnItsOwn(cause: unknown): boolean {
  if (cause instanceof pg.DatabaseError) {
    return cause.code === CANNOT_CONNECT_NOW;
  }
  return true;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The one constructor for a Postgres pool a composition owns. It exists
 * because a `pg.Pool` is an EventEmitter that re-emits an idle client's
 * error as its own `'error'` event, and an EventEmitter with no `'error'`
 * listener turns that emit into a throw from the event loop: not a
 * rejected promise anything awaits, a process crash: a database that
 * terminates its idle backends (`terminating connection due to
 * administrator command`) would take the server with it. The OSS store's
 * pool carries the listener (@stigmer/server, store/postgres/store.ts);
 * this module gives a composition's pools the same posture, once.
 *
 * Why warn-only and not a reconnect or a shutdown: the pool has already
 * dropped the dead client by the time it emits, and the next checkout
 * opens a fresh connection on its own. There is nothing to repair and
 * nothing to stop; the line exists so an operator reading the log can
 * tell an idle-connection churn from a request failure. The message is
 * the OSS store's, byte for byte, so one search finds every pool's
 * report; the `pool` field says which pool it was.
 *
 * Why a checkout deadline: pg's default waits for a free client forever,
 * so a pool whose clients are all held turns every later query into a
 * request that never answers, and nothing in the log says why. With
 * `connectionTimeoutMillis` a starved checkout fails with `timeout exceeded
 * when trying to connect`, through the request's own error path. Ten
 * seconds is far past any healthy wait for a client and well inside a
 * caller's patience. The bound covers waiting for a client and opening a
 * new connection, never how long a client is held, so a long migration or
 * a lock's transaction is untouched.
 *
 * Why a name: each composition owns its pools by design (a self-hosted
 * Enterprise server one over its database, `enterprise`). A new pool is a
 * design act that each composition's guard reviews as a new name, rather
 * than appearing as another bare `new pg.Pool` somewhere in a unit; the
 * same guard refuses the bare form anywhere else.
 */
import pg from "pg";
import type { Logger } from "@stigmer/server";

/** How long a query waits for a client before it fails instead of hanging. */
export const POOL_CHECKOUT_TIMEOUT_MS = 10_000;

/** A pool's name, in its log lines; each composition's guard pins the names it builds. */
export type CompositionPoolName = string;

export interface CompositionPoolOptions {
  readonly name: CompositionPoolName;
  readonly connectionString: string;
  readonly logger: Logger;
}

/**
 * A `pg.Pool` over `connectionString` whose idle-connection errors are a
 * WARN line carrying `pool: name`, never an unhandled `'error'` event, and
 * whose checkouts fail after `POOL_CHECKOUT_TIMEOUT_MS` instead of waiting
 * forever.
 */
export function newCompositionPool(options: CompositionPoolOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    connectionTimeoutMillis: POOL_CHECKOUT_TIMEOUT_MS,
  });
  pool.on("error", (error) => {
    options.logger.warn("postgres pool idle-connection error", {
      pool: options.name,
      error: error.message,
    });
  });
  return pool;
}

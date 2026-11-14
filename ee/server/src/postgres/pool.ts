/**
 * The one constructor for a Postgres pool a composition owns. It builds on
 * `@stigmer/server`'s bounded pool (`newBoundedPool`, the store's own pool
 * constructor), so a composition's pools and the store's share one size,
 * one checkout deadline and one failure type: a checkout that waits past
 * the deadline, or a database that cannot be reached, rejects with
 * `DatabaseUnavailableError`, which every RPC answers as Unavailable ("try
 * again") rather than Internal. That module's header gives the reasons for
 * the size (20) and the deadline (ten seconds, covering the wait for a
 * client and the opening of one, never how long a client is held). This
 * module adds the two things a composition's pool needs beyond that.
 *
 * Why a warn-only idle-error listener with a name: a `pg.Pool` is an
 * EventEmitter that re-emits an idle client's error as its own `'error'`
 * event, and an EventEmitter with no `'error'` listener turns that emit
 * into a throw from the event loop: not a rejected promise anything awaits,
 * a process crash: a database that terminates its idle backends
 * (`terminating connection due to administrator command`) would take the
 * server with it. The pool has already dropped the dead client by the time
 * it emits, and the next checkout opens a fresh connection on its own.
 * There is nothing to repair and nothing to stop; the line exists so an
 * operator reading the log can tell an idle-connection churn from a request
 * failure. The message is the OSS store's, byte for byte, so one search
 * finds every pool's report; the `pool` field says which pool it was.
 *
 * Why a name: each composition owns its pools by design (a self-hosted
 * Enterprise server one over its database, `enterprise`). A new pool is a
 * design act that each composition's guard reviews as a new name, rather
 * than appearing as another bare `new pg.Pool` somewhere in a unit; the
 * same guard refuses the bare form anywhere else.
 */
import {
  DEFAULT_POOL_CHECKOUT_TIMEOUT_MS,
  newBoundedPool,
} from "@stigmer/server";
import type { BoundedPool, Logger } from "@stigmer/server";

/**
 * How long a query waits for a client before it fails instead of hanging:
 * the store's own deadline, so there is one number.
 */
export const POOL_CHECKOUT_TIMEOUT_MS = DEFAULT_POOL_CHECKOUT_TIMEOUT_MS;

/** A pool's name, in its log lines; each composition's guard pins the names it builds. */
export type CompositionPoolName = string;

export interface CompositionPoolOptions {
  readonly name: CompositionPoolName;
  readonly connectionString: string;
  readonly logger: Logger;
}

/**
 * A bounded pool over `connectionString` whose idle-connection errors are a
 * WARN line carrying `pool: name`, never an unhandled `'error'` event, and
 * whose failed checkouts reject with `DatabaseUnavailableError` after at
 * most `POOL_CHECKOUT_TIMEOUT_MS` instead of waiting forever.
 */
export function newCompositionPool(
  options: CompositionPoolOptions,
): BoundedPool {
  return newBoundedPool({
    connectionString: options.connectionString,
    onIdleError: (error) => {
      options.logger.warn("postgres pool idle-connection error", {
        pool: options.name,
        error: error.message,
      });
    },
  });
}

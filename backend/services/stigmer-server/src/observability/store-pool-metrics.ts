/**
 * The store's Postgres pool, as metrics (stigmer/stigmer#3086): how many
 * connections it holds and how many requests wait for one, and how many
 * checkouts it failed. A pool that cannot hand out a connection answers
 * Unavailable after its checkout deadline (store/postgres/pool.ts); these
 * say whether that was a database that stalled or a pool too small for its
 * load, before the first request fails.
 *
 *   - `stigmer.store.pool.connections`, an observable gauge with `state`:
 *     `total` (open connections), `idle` (open and free) and `waiting`
 *     (requests queued for a connection; above zero for long means the
 *     pool is too small or a query is holding its connections);
 *   - `stigmer.store.pool.checkout_failures`, an observable counter: the
 *     checkouts that ended in `DatabaseUnavailableError` since boot.
 *
 * No tenant attribute: the pool is the server's, not an organization's.
 *
 * rpc-metrics.ts's idiom: instruments created lazily on the global meter on
 * `@opentelemetry/api` alone, inert until a host registers a provider. The
 * store imports no observability, so the composition root hands this module
 * the store's own reader (`PostgresStore.poolStats`) when it serves on
 * Postgres, and removes it in the drain before the store closes. The pools a
 * composition owns are not observed here: each composition owns its pools.
 */
import type {
  BatchObservableCallback,
  Meter,
  ObservableCounter,
  ObservableGauge,
} from "@opentelemetry/api";

import type { PoolStats } from "../store/postgres/pool.js";

const METER_NAME = "stigmer-server";

export const STORE_POOL_CONNECTIONS = "stigmer.store.pool.connections";
export const STORE_POOL_CHECKOUT_FAILURES =
  "stigmer.store.pool.checkout_failures";

interface Instruments {
  readonly meter: Meter;
  readonly connections: ObservableGauge;
  readonly checkoutFailures: ObservableCounter;
}

let instrumentsPromise: Promise<Instruments> | null = null;

function instruments(): Promise<Instruments> {
  instrumentsPromise ??= import("@opentelemetry/api").then((api) => {
    const meter = api.metrics.getMeter(METER_NAME);
    return {
      meter,
      connections: meter.createObservableGauge(STORE_POOL_CONNECTIONS, {
        description:
          "Connections in the Stigmer server's store pool, and requests waiting for one, by state",
      }),
      checkoutFailures: meter.createObservableCounter(
        STORE_POOL_CHECKOUT_FAILURES,
        {
          description:
            "Checkouts from the Stigmer server's store pool that failed (the request was answered Unavailable)",
        },
      ),
    };
  });
  return instrumentsPromise;
}

/**
 * Observes `read` on every collection until the returned function stops it.
 * `read` is the store's own counters, so it is cheap and never throws.
 */
export async function observeStorePool(
  read: () => PoolStats,
): Promise<() => void> {
  const { meter, connections, checkoutFailures } = await instruments();
  const callback: BatchObservableCallback = (result) => {
    const stats = read();
    result.observe(connections, stats.total, { state: "total" });
    result.observe(connections, stats.idle, { state: "idle" });
    result.observe(connections, stats.waiting, { state: "waiting" });
    result.observe(checkoutFailures, stats.checkoutFailures);
  };
  const observables = [connections, checkoutFailures];
  meter.addBatchObservableCallback(callback, observables);
  return () => {
    meter.removeBatchObservableCallback(callback, observables);
  };
}

/** Test seam: clears the memoized instruments. */
export function resetStorePoolMetrics(): void {
  instrumentsPromise = null;
}

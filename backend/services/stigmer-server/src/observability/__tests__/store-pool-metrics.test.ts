/**
 * Pins the store pool's metrics (store-pool-metrics.ts) on a real meter
 * provider: the two instrument names, the connections gauge's one `state`
 * attribute with its three values and nothing tenant-shaped, the failure
 * counter read from the pool's own count, each read live at collection, and
 * nothing observed once the composition root stops it in the drain.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PoolStats } from "../../store/postgres/pool.js";
import {
  STORE_POOL_CHECKOUT_FAILURES,
  STORE_POOL_CONNECTIONS,
  observeStorePool,
  resetStorePoolMetrics,
} from "../store-pool-metrics.js";
import { inMemoryMeter, type InMemoryMeter } from "./in-memory-meter.js";

let meter: InMemoryMeter;

beforeEach(async () => {
  meter = await inMemoryMeter(resetStorePoolMetrics);
});

afterEach(async () => {
  await meter.dispose();
});

function byState(points: ReadonlyArray<{ value: unknown; attributes: Record<string, unknown> }>) {
  return Object.fromEntries(points.map((point) => [point.attributes["state"], point.value]));
}

describe("the store pool's metrics", () => {
  it("reads connections by state and the checkout failures at each collection", async () => {
    let stats: PoolStats = { max: 20, total: 3, idle: 1, waiting: 0, checkoutFailures: 0 };
    const stop = await observeStorePool(() => stats);
    try {
      let collected = await meter.collect();
      const connections = collected.get(STORE_POOL_CONNECTIONS) ?? [];
      expect(connections.map((point) => Object.keys(point.attributes))).toEqual([["state"], ["state"], ["state"]]);
      expect(byState(connections)).toEqual({ total: 3, idle: 1, waiting: 0 });
      expect(collected.get(STORE_POOL_CHECKOUT_FAILURES)).toEqual([{ value: 0, attributes: {} }]);

      stats = { max: 20, total: 20, idle: 0, waiting: 7, checkoutFailures: 2 };
      collected = await meter.collect();
      expect(byState(collected.get(STORE_POOL_CONNECTIONS) ?? [])).toEqual({ total: 20, idle: 0, waiting: 7 });
      expect(collected.get(STORE_POOL_CHECKOUT_FAILURES)).toEqual([{ value: 2, attributes: {} }]);
    } finally {
      stop();
    }
  });

  it("stops reading the pool once stopped", async () => {
    let reads = 0;
    const stop = await observeStorePool(() => {
      reads += 1;
      return { max: 20, total: 0, idle: 0, waiting: 0, checkoutFailures: 0 };
    });
    await meter.collect();
    expect(reads).toBe(1);
    stop();
    await meter.collect();
    expect(reads).toBe(1);
  });
});

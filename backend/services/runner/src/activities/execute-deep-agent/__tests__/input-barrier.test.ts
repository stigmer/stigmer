/**
 * Pins the Stigmer harness's barrier before a take (../input-barrier.ts): a
 * crossing writes one barrier and waits until the loop reaches it, goes on
 * after its wait when the loop never does, and goes on at once with no
 * writer; the loop reads a barrier's id from its custom-stream event only.
 */
import { describe, expect, it, vi } from "vitest";

import { INPUT_BARRIER_EVENT, InputBarriers, barrierIdOf } from "../input-barrier.js";

describe("InputBarriers", () => {
  it("writes one barrier and waits until the loop reaches it", async () => {
    const barriers = new InputBarriers();
    const written: unknown[] = [];
    let crossed = false;
    const crossing = barriers.cross((chunk) => written.push(chunk), 60_000).then(() => (crossed = true));
    await Promise.resolve();
    expect(written).toEqual([{ name: INPUT_BARRIER_EVENT, barrier_id: "barrier-1" }]);
    expect(crossed).toBe(false);
    barriers.reach("barrier-1");
    await crossing;
    expect(crossed).toBe(true);
  });

  it("goes on after its wait when the loop never reaches it, and at once with no writer", async () => {
    vi.useFakeTimers();
    try {
      const barriers = new InputBarriers();
      const crossing = barriers.cross(() => undefined, 1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      await crossing;
      barriers.reach("barrier-1");
    } finally {
      vi.useRealTimers();
    }
    await new InputBarriers().cross(undefined);
  });
});

describe("barrierIdOf", () => {
  it("reads a barrier's id from its custom-stream event, and nothing from any other", () => {
    expect(barrierIdOf({ method: "custom", params: { data: { name: INPUT_BARRIER_EVENT, barrier_id: "b1" } } })).toBe("b1");
    expect(barrierIdOf({ method: "custom", params: { data: { name: "tool_refused", barrier_id: "b1" } } })).toBeUndefined();
    expect(barrierIdOf({ method: "custom", params: { data: null } })).toBeUndefined();
    expect(barrierIdOf({ method: "custom", params: { data: { name: INPUT_BARRIER_EVENT, barrier_id: 7 } } })).toBeUndefined();
    expect(barrierIdOf({ method: "messages", params: {} })).toBeUndefined();
  });
});

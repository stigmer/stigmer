import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeBackoffDelay,
  sleep,
  AbortError,
  DEFAULT_RECONNECT_BASE_DELAY_MS,
  DEFAULT_RECONNECT_MAX_DELAY_MS,
} from "../backoff";

describe("computeBackoffDelay", () => {
  // random=()=>1 collapses full jitter to its upper bound, exposing the raw
  // exponential schedule for exact assertions.
  const noJitter = () => 1;

  it("grows exponentially from the base delay", () => {
    expect(computeBackoffDelay(1, undefined, noJitter)).toBe(
      DEFAULT_RECONNECT_BASE_DELAY_MS,
    );
    expect(computeBackoffDelay(2, undefined, noJitter)).toBe(2_000);
    expect(computeBackoffDelay(3, undefined, noJitter)).toBe(4_000);
    expect(computeBackoffDelay(5, undefined, noJitter)).toBe(16_000);
  });

  it("caps at maxDelayMs", () => {
    // attempt 6 → 32_000 raw, clamped to the 30_000 ceiling.
    expect(computeBackoffDelay(6, undefined, noJitter)).toBe(
      DEFAULT_RECONNECT_MAX_DELAY_MS,
    );
    expect(computeBackoffDelay(50, undefined, noJitter)).toBe(
      DEFAULT_RECONNECT_MAX_DELAY_MS,
    );
  });

  it("applies full jitter within [0, capped]", () => {
    expect(computeBackoffDelay(3, undefined, () => 0)).toBe(0);
    expect(computeBackoffDelay(3, undefined, () => 0.5)).toBe(2_000);
    for (let i = 0; i < 200; i++) {
      const d = computeBackoffDelay(4); // real Math.random
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(8_000);
    }
  });

  it("honors custom options", () => {
    const opts = { baseDelayMs: 100, factor: 3, maxDelayMs: 1_000 };
    expect(computeBackoffDelay(1, opts, noJitter)).toBe(100);
    expect(computeBackoffDelay(2, opts, noJitter)).toBe(300);
    expect(computeBackoffDelay(3, opts, noJitter)).toBe(900);
    expect(computeBackoffDelay(4, opts, noJitter)).toBe(1_000); // 2700 capped
  });

  it("treats attempt < 1 as the first attempt", () => {
    expect(computeBackoffDelay(0, undefined, noJitter)).toBe(
      DEFAULT_RECONNECT_BASE_DELAY_MS,
    );
    expect(computeBackoffDelay(-5, undefined, noJitter)).toBe(
      DEFAULT_RECONNECT_BASE_DELAY_MS,
    );
  });
});

describe("sleep", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves after the delay", async () => {
    const settled = vi.fn();
    const p = sleep(1_000).then(settled);
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toHaveBeenCalledOnce();
  });

  it("rejects immediately with AbortError when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(sleep(1_000, ac.signal)).rejects.toBeInstanceOf(AbortError);
  });

  it("rejects when aborted mid-wait and leaves no pending timer", async () => {
    const ac = new AbortController();
    const p = sleep(10_000, ac.signal);
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(AbortError);
    // No timer should survive the abort — advancing time settles nothing.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not reject after resolving (listener removed on success)", async () => {
    const ac = new AbortController();
    const p = sleep(500, ac.signal);
    await vi.advanceTimersByTimeAsync(500);
    await expect(p).resolves.toBeUndefined();
    // Aborting after the fact must not produce an unhandled rejection.
    expect(() => ac.abort()).not.toThrow();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FetchCache } from "../fetch-cache";

describe("FetchCache", () => {
  // -------------------------------------------------------------------
  // get / set / has
  // -------------------------------------------------------------------

  it("returns undefined for a missing key", () => {
    const cache = new FetchCache();
    expect(cache.get("nope")).toBeUndefined();
    expect(cache.has("nope")).toBe(false);
  });

  it("stores and retrieves a value", () => {
    const cache = new FetchCache();
    const obj = { id: "ses_1", name: "Test" };
    cache.set("session:ses_1", obj);

    expect(cache.get("session:ses_1")).toBe(obj);
    expect(cache.has("session:ses_1")).toBe(true);
  });

  it("overwrites an existing entry", () => {
    const cache = new FetchCache();
    cache.set("k", "first");
    cache.set("k", "second");
    expect(cache.get("k")).toBe("second");
  });

  it("preserves reference identity (no cloning)", () => {
    const cache = new FetchCache();
    const arr = [1, 2, 3];
    cache.set("k", arr);
    expect(cache.get("k")).toBe(arr);
  });

  // -------------------------------------------------------------------
  // TTL
  // -------------------------------------------------------------------

  describe("TTL expiration", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns the value before TTL expires", () => {
      const cache = new FetchCache({ ttl: 1000 });
      cache.set("k", "v");

      vi.advanceTimersByTime(999);
      expect(cache.get("k")).toBe("v");
    });

    it("returns undefined after TTL expires", () => {
      const cache = new FetchCache({ ttl: 1000 });
      cache.set("k", "v");

      vi.advanceTimersByTime(1001);
      expect(cache.get("k")).toBeUndefined();
      expect(cache.has("k")).toBe(false);
    });

    it("expired entries are excluded from size", () => {
      const cache = new FetchCache({ ttl: 500 });
      cache.set("a", 1);
      cache.set("b", 2);

      vi.advanceTimersByTime(501);
      expect(cache.size).toBe(0);
    });

    it("writing refreshes the timestamp", () => {
      const cache = new FetchCache({ ttl: 1000 });
      cache.set("k", "first");

      vi.advanceTimersByTime(800);
      cache.set("k", "second");

      vi.advanceTimersByTime(800);
      expect(cache.get("k")).toBe("second");
    });
  });

  // -------------------------------------------------------------------
  // LRU eviction
  // -------------------------------------------------------------------

  it("evicts the oldest entries when maxEntries is exceeded", () => {
    const cache = new FetchCache({ maxEntries: 3 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("d", 4);

    expect(cache.has("a")).toBe(false);
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
    expect(cache.size).toBe(3);
  });

  it("re-setting a key moves it to the tail (LRU refresh)", () => {
    const cache = new FetchCache({ maxEntries: 3 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    // Touch "a" — moves it to the tail.
    cache.set("a", 10);

    // Adding "d" should evict "b" (the oldest untouched), not "a".
    cache.set("d", 4);

    expect(cache.has("b")).toBe(false);
    expect(cache.get("a")).toBe(10);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
  });

  // -------------------------------------------------------------------
  // invalidate / invalidatePrefix / clear
  // -------------------------------------------------------------------

  it("invalidate removes a single entry", () => {
    const cache = new FetchCache();
    cache.set("a", 1);
    cache.set("b", 2);

    cache.invalidate("a");

    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
  });

  it("invalidate is a no-op for missing keys", () => {
    const cache = new FetchCache();
    expect(() => cache.invalidate("nope")).not.toThrow();
  });

  it("invalidatePrefix removes all matching entries", () => {
    const cache = new FetchCache();
    cache.set("session:1", "s1");
    cache.set("session:2", "s2");
    cache.set("session-executions:1", "e1");
    cache.set("agent:a", "ag");

    cache.invalidatePrefix("session:");

    expect(cache.has("session:1")).toBe(false);
    expect(cache.has("session:2")).toBe(false);
    expect(cache.has("session-executions:1")).toBe(true);
    expect(cache.has("agent:a")).toBe(true);
  });

  it("clear drops all entries", () => {
    const cache = new FetchCache();
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.has("a")).toBe(false);
  });

  // -------------------------------------------------------------------
  // prefetch
  // -------------------------------------------------------------------

  it("prefetch writes successful result to cache", async () => {
    const cache = new FetchCache();
    const fetchFn = vi.fn(async () => ({ id: "ses_1" }));

    cache.prefetch("session:ses_1", fetchFn);
    await vi.waitFor(() => expect(cache.has("session:ses_1")).toBe(true));

    expect(cache.get("session:ses_1")).toEqual({ id: "ses_1" });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("prefetch silently swallows errors", async () => {
    const cache = new FetchCache();
    const fetchFn = vi.fn(async () => {
      throw new Error("network down");
    });

    cache.prefetch("k", fetchFn);

    // Give the microtask queue time to process the rejection.
    await new Promise((r) => setTimeout(r, 0));

    expect(cache.has("k")).toBe(false);
  });

  // -------------------------------------------------------------------
  // size
  // -------------------------------------------------------------------

  it("reports correct size", () => {
    const cache = new FetchCache();
    expect(cache.size).toBe(0);

    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.size).toBe(2);

    cache.invalidate("a");
    expect(cache.size).toBe(1);
  });

  // -------------------------------------------------------------------
  // defaults
  // -------------------------------------------------------------------

  it("uses default maxEntries of 100", () => {
    const cache = new FetchCache();
    for (let i = 0; i < 110; i++) {
      cache.set(`k${i}`, i);
    }
    expect(cache.size).toBe(100);
    // First 10 should have been evicted.
    expect(cache.has("k0")).toBe(false);
    expect(cache.has("k10")).toBe(true);
  });
});

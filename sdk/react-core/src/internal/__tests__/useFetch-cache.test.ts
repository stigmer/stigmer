import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { FetchCacheContext, useFetchCache } from "../FetchCacheProvider";
import { FetchCache } from "../fetch-cache";
import { useFetch } from "../useFetch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * Build a wrapper that provides a specific FetchCache instance via
 * context. Tests that need cross-mount caching share the same cache
 * object, mirroring the production layout where FetchCacheProvider
 * sits above the key-based remount boundary.
 */
function createCacheWrapper(cache: FetchCache) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(FetchCacheContext.Provider, { value: cache }, children);
  };
}

// ---------------------------------------------------------------------------
// Tests: useFetch + FetchCacheProvider
// ---------------------------------------------------------------------------

describe("useFetch — cache integration", () => {
  it("serves cached data on mount and skips isLoading", async () => {
    const cache = new FetchCache();
    const wrapper = createCacheWrapper(cache);

    // First mount: populate the cache via a normal fetch.
    const fetchFn = vi.fn(async () => "fetched-value");

    const { result, unmount } = renderHook(
      () => useFetch(fetchFn, [], "init", { cacheKey: "test:1" }),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(true);
    await flush();
    expect(result.current.data).toBe("fetched-value");
    expect(result.current.isLoading).toBe(false);

    unmount();

    // Second mount (simulating remount after key change): should
    // seed state from cache and never show isLoading.
    const fetchFn2 = vi.fn(async () => "fresh-value");
    const { result: result2 } = renderHook(
      () => useFetch(fetchFn2, [], "init", { cacheKey: "test:1" }),
      { wrapper },
    );

    // On mount, cached data is available immediately.
    expect(result2.current.data).toBe("fetched-value");
    expect(result2.current.isLoading).toBe(false);
    expect(result2.current.isRefetching).toBe(true);

    // Background fetch completes and updates data.
    await flush();
    expect(result2.current.data).toBe("fresh-value");
    expect(result2.current.isRefetching).toBe(false);
  });

  it("falls back to initialData on cache miss", async () => {
    const cache = new FetchCache();
    const wrapper = createCacheWrapper(cache);
    const fetchFn = vi.fn(async () => "fetched");

    const { result } = renderHook(
      () => useFetch(fetchFn, [], "init", { cacheKey: "miss:1" }),
      { wrapper },
    );

    expect(result.current.data).toBe("init");
    expect(result.current.isLoading).toBe(true);

    await flush();
    expect(result.current.data).toBe("fetched");
  });

  it("writes to cache on fetch success", async () => {
    const cache = new FetchCache();
    const wrapper = createCacheWrapper(cache);
    const fetchFn = vi.fn(async () => "data-1");

    const { result } = renderHook(
      () => useFetch(fetchFn, [], "init", { cacheKey: "write:1" }),
      { wrapper },
    );

    expect(cache.has("write:1")).toBe(false);

    await flush();
    expect(result.current.data).toBe("data-1");
    expect(cache.get("write:1")).toBe("data-1");
  });

  it("does not interact with cache when cacheKey is undefined", async () => {
    const cache = new FetchCache();
    const wrapper = createCacheWrapper(cache);
    const fetchFn = vi.fn(async () => "val");

    const { result } = renderHook(
      () => useFetch(fetchFn, [], "init"),
      { wrapper },
    );

    await flush();
    expect(result.current.data).toBe("val");
    expect(cache.size).toBe(0);
  });

  it("works without FetchCacheProvider (graceful degradation)", async () => {
    const fetchFn = vi.fn(async () => "value");

    // No wrapper — no provider.
    const { result } = renderHook(() =>
      useFetch(fetchFn, [], "init", { cacheKey: "no-provider:1" }),
    );

    expect(result.current.data).toBe("init");
    expect(result.current.isLoading).toBe(true);

    await flush();
    expect(result.current.data).toBe("value");
    expect(result.current.isLoading).toBe(false);
  });

  it("does not read cache when fetchFn is null", async () => {
    const cache = new FetchCache();
    const wrapper = createCacheWrapper(cache);

    const fetchFn1 = vi.fn(async () => "cached-val");

    // First: populate cache.
    const { unmount } = renderHook(
      () => useFetch(fetchFn1, [], "init", { cacheKey: "null-fn:1" }),
      { wrapper },
    );
    await flush();
    unmount();

    // Second: mount with fetchFn=null — should reset to initialData
    // even though cache has data for this key.
    const { result } = renderHook(
      () =>
        useFetch(null, [], "fallback" as string | null, {
          cacheKey: "null-fn:1",
        }),
      { wrapper },
    );

    expect(result.current.data).toBe("fallback");
    expect(result.current.isLoading).toBe(false);
  });

  it("does not write to cache on fetch error", async () => {
    const cache = new FetchCache();
    const wrapper = createCacheWrapper(cache);
    const fetchFn = vi.fn(async () => {
      throw new Error("fail");
    });

    const { result } = renderHook(
      () => useFetch(fetchFn, [], "init", { cacheKey: "err:1" }),
      { wrapper },
    );

    await flush();
    expect(result.current.error?.message).toBe("fail");
    expect(cache.has("err:1")).toBe(false);
  });

  it("independent cache keys do not interfere", async () => {
    const cache = new FetchCache();
    const wrapper = createCacheWrapper(cache);

    const fetchA = vi.fn(async () => "session-A");
    const fetchB = vi.fn(async () => "session-B");

    const { unmount: unmountA } = renderHook(
      () => useFetch(fetchA, [], null, { cacheKey: "session:A" }),
      { wrapper },
    );
    await flush();
    unmountA();

    const { unmount: unmountB } = renderHook(
      () => useFetch(fetchB, [], null, { cacheKey: "session:B" }),
      { wrapper },
    );
    await flush();
    unmountB();

    // Remount A — should get A's cached data, not B's.
    const { result } = renderHook(
      () => useFetch(vi.fn(async () => "fresh-A"), [], null, { cacheKey: "session:A" }),
      { wrapper },
    );

    expect(result.current.data).toBe("session-A");
    expect(result.current.isLoading).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { FetchCacheContext } from "../FetchCacheProvider";
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

function createCacheWrapper(cache: FetchCache) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(FetchCacheContext.Provider, { value: cache }, children);
  };
}

// ---------------------------------------------------------------------------
// Tests: useFetch resets data on identity (dep) change
//
// These tests verify the Layer 1 fix for the premature worker shutdown bug.
// When deps change (e.g. executionId switches from A→B), useFetch must NOT
// keep showing A's terminal-phase data while B's fetch is in flight — that
// stale data caused useWorkflowExecution's termination effect to fire
// onWorkflowExecutionTerminated(B) using A's completed phase.
// ---------------------------------------------------------------------------

describe("useFetch — identity reset on dep change (no cache)", () => {
  it("resets data to initialData when deps change without cache", async () => {
    let currentId = "exec-A";
    const results: Record<string, string> = {
      "exec-A": "data-A",
      "exec-B": "data-B",
    };

    const fetchFn = vi.fn(async () => results[currentId]!);

    const { result, rerender } = renderHook(
      () => useFetch(fetchFn, [currentId], "init"),
    );

    await flush();
    expect(result.current.data).toBe("data-A");

    // Switch identity — simulate navigating from execution A to B
    currentId = "exec-B";
    rerender();
    // Immediately after dep change, data should reset to initialData
    // (not keep stale "data-A")
    expect(result.current.data).toBe("init");

    await flush();
    expect(result.current.data).toBe("data-B");
  });

  it("resets data between rapid identity switches", async () => {
    let currentId = "id-1";
    const fetchFn = vi.fn(async () => `result-${currentId}`);

    const { result, rerender } = renderHook(
      () => useFetch(fetchFn, [currentId], null as string | null),
    );

    await flush();
    expect(result.current.data).toBe("result-id-1");

    // Switch to id-2
    currentId = "id-2";
    rerender();
    expect(result.current.data).toBeNull();
    await flush();
    expect(result.current.data).toBe("result-id-2");

    // Switch to id-3
    currentId = "id-3";
    rerender();
    expect(result.current.data).toBeNull();
    await flush();
    expect(result.current.data).toBe("result-id-3");
  });

  it("does not leak old data during slow fetch on dep change", async () => {
    let resolveFetch: ((v: string) => void) | null = null;
    let currentId = "slow-A";

    const fetchFn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { result, rerender } = renderHook(
      () => useFetch(fetchFn, [currentId], "init"),
    );

    // Resolve initial fetch
    await act(async () => {
      resolveFetch!("data-slow-A");
      await Promise.resolve();
    });
    expect(result.current.data).toBe("data-slow-A");

    // Switch dep — new slow fetch starts
    currentId = "slow-B";
    rerender();
    // Data must be reset to initialData, NOT keep "data-slow-A"
    expect(result.current.data).toBe("init");
    expect(result.current.isLoading).toBe(true);

    // Resolve the second fetch
    await act(async () => {
      resolveFetch!("data-slow-B");
      await Promise.resolve();
    });
    expect(result.current.data).toBe("data-slow-B");
    expect(result.current.isLoading).toBe(false);
  });
});

describe("useFetch — identity reset on dep change (with cache)", () => {
  it("shows cached data for new key if available, not stale data from old key", async () => {
    const cache = new FetchCache();
    const wrapper = createCacheWrapper(cache);

    // Pre-populate cache for both keys
    cache.set("exec:A", "cached-A");
    cache.set("exec:B", "cached-B");

    let currentId = "A";
    const fetchFn = vi.fn(async () => `fresh-${currentId}`);

    const { result, rerender } = renderHook(
      () =>
        useFetch(fetchFn, [currentId], null as string | null, {
          cacheKey: `exec:${currentId}`,
        }),
      { wrapper },
    );

    // Initial mount: cache hit for A
    expect(result.current.data).toBe("cached-A");
    await flush();
    expect(result.current.data).toBe("fresh-A");

    // Switch to B — should show cached-B, NOT stale fresh-A
    currentId = "B";
    rerender();
    expect(result.current.data).toBe("cached-B");

    await flush();
    expect(result.current.data).toBe("fresh-B");
  });

  it("falls back to initialData on cache miss for new key", async () => {
    const cache = new FetchCache();
    const wrapper = createCacheWrapper(cache);

    // Only populate cache for A
    cache.set("exec:A", "cached-A");

    let currentId = "A";
    const fetchFn = vi.fn(async () => `fresh-${currentId}`);

    const { result, rerender } = renderHook(
      () =>
        useFetch(fetchFn, [currentId], null as string | null, {
          cacheKey: `exec:${currentId}`,
        }),
      { wrapper },
    );

    await flush();
    expect(result.current.data).toBe("fresh-A");

    // Switch to B — no cache entry, should show initialData (null)
    currentId = "B";
    rerender();
    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(true);

    await flush();
    expect(result.current.data).toBe("fresh-B");
  });
});

describe("useFetch — cancelled fetch from previous identity", () => {
  it("ignores resolved data from a cancelled previous-identity fetch", async () => {
    let resolvers: Array<(v: string) => void> = [];
    let callIdx = 0;
    let currentId = "id-X";

    const fetchFn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolvers[callIdx++] = resolve;
        }),
    );

    const { result, rerender } = renderHook(
      () => useFetch(fetchFn, [currentId], "init"),
    );

    // First fetch is in flight (for id-X)
    expect(result.current.isLoading).toBe(true);

    // Switch to id-Y before id-X resolves
    currentId = "id-Y";
    rerender();
    expect(result.current.data).toBe("init");

    // Resolve the OLD fetch (id-X) — should be ignored
    await act(async () => {
      resolvers[0]!("stale-data-X");
      await Promise.resolve();
    });
    // Data should still be "init" (waiting for id-Y), not "stale-data-X"
    // The id-Y fetch is still in flight
    expect(result.current.data).not.toBe("stale-data-X");

    // Resolve the NEW fetch (id-Y)
    await act(async () => {
      resolvers[1]!("fresh-data-Y");
      await Promise.resolve();
    });
    expect(result.current.data).toBe("fresh-data-Y");
  });
});

// ---------------------------------------------------------------------------
// Tests: refetch() preserves stale data (no skeleton flash)
//
// These tests verify that imperative refetch() — triggered by the sidebar's
// navigation effect and staggered timers — does NOT reset data or flash
// isLoading. The stale-while-revalidate contract requires that existing
// data remains visible during background refetches, with only isRefetching
// signaling the in-flight state.
// ---------------------------------------------------------------------------

describe("useFetch — refetch preserves stale data (no skeleton flash)", () => {
  it("keeps stale data visible during refetch (no cacheKey)", async () => {
    let callCount = 0;
    const fetchFn = vi.fn(async () => `data-${++callCount}`);

    const { result } = renderHook(() =>
      useFetch(fetchFn, [], "init"),
    );

    await flush();
    expect(result.current.data).toBe("data-1");
    expect(result.current.isLoading).toBe(false);

    // Trigger refetch — stale data must stay visible
    act(() => result.current.refetch());
    expect(result.current.data).toBe("data-1");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isRefetching).toBe(true);

    await flush();
    expect(result.current.data).toBe("data-2");
    expect(result.current.isRefetching).toBe(false);
  });

  it("keeps isLoading false across multiple consecutive refetches", async () => {
    let callCount = 0;
    const fetchFn = vi.fn(async () => `v${++callCount}`);

    const { result } = renderHook(() =>
      useFetch(fetchFn, [], "init"),
    );

    await flush();
    expect(result.current.data).toBe("v1");

    // Three rapid refetches — none should flash isLoading
    for (let i = 0; i < 3; i++) {
      act(() => result.current.refetch());
      expect(result.current.isLoading).toBe(false);
      expect(result.current.data).not.toBe("init");
      await flush();
    }
    expect(result.current.data).toBe("v4");
  });

  it("correctly resets on identity dep change after refetch", async () => {
    let currentId = "A";
    const fetchFn = vi.fn(async () => `data-${currentId}`);

    const { result, rerender } = renderHook(() =>
      useFetch(fetchFn, [currentId], "init"),
    );

    await flush();
    expect(result.current.data).toBe("data-A");

    // Refetch — should preserve stale data
    act(() => result.current.refetch());
    expect(result.current.data).toBe("data-A");
    expect(result.current.isLoading).toBe(false);
    await flush();

    // Identity dep change — should reset to initialData
    currentId = "B";
    rerender();
    expect(result.current.data).toBe("init");
    expect(result.current.isLoading).toBe(true);

    await flush();
    expect(result.current.data).toBe("data-B");
    expect(result.current.isLoading).toBe(false);
  });

  it("preserves stale data during slow refetch", async () => {
    let resolveFetch: ((v: string) => void) | null = null;
    let callCount = 0;

    const fetchFn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { result } = renderHook(() =>
      useFetch(fetchFn, [], "init"),
    );

    // Resolve initial fetch
    await act(async () => {
      resolveFetch!("first");
      await Promise.resolve();
    });
    expect(result.current.data).toBe("first");

    // Trigger refetch — slow fetch starts, stale data stays
    act(() => result.current.refetch());
    expect(result.current.data).toBe("first");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isRefetching).toBe(true);

    // Resolve the refetch
    await act(async () => {
      resolveFetch!("second");
      await Promise.resolve();
    });
    expect(result.current.data).toBe("second");
    expect(result.current.isRefetching).toBe(false);
  });

  it("does not flash skeleton during refetchInterval polling", async () => {
    vi.useFakeTimers();

    let callCount = 0;
    const fetchFn = vi.fn(async () => `poll-${++callCount}`);

    const { result } = renderHook(() =>
      useFetch(fetchFn, [], "init", { refetchInterval: 1000 }),
    );

    await flush();
    expect(result.current.data).toBe("poll-1");
    expect(result.current.isLoading).toBe(false);

    // Advance past poll interval — data should update without skeleton
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBe("poll-2");

    // Another tick
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBe("poll-3");

    vi.useRealTimers();
  });
});

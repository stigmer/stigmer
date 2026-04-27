import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFetch } from "../useFetch";

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useFetch — refetchInterval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls at the specified interval", async () => {
    let callCount = 0;
    const fetchFn = vi.fn(async () => ++callCount);

    const { result } = renderHook(() =>
      useFetch(fetchFn, [], 0, { refetchInterval: 1000 }),
    );

    // Flush the initial dep-change fetch.
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe(1);

    // Advance by one interval — should trigger a poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe(2);

    // Another interval tick.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("does not poll when refetchInterval is false", async () => {
    const fetchFn = vi.fn(async () => "data");

    renderHook(() => useFetch(fetchFn, [], "", { refetchInterval: false }));

    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("does not poll when fetchFn is null", async () => {
    const { result } = renderHook(() =>
      useFetch(null, [], "init", { refetchInterval: 1000 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(result.current.data).toBe("init");
    expect(result.current.isLoading).toBe(false);
  });

  it("cleans up interval on unmount", async () => {
    const fetchFn = vi.fn(async () => "data");

    const { unmount } = renderHook(() =>
      useFetch(fetchFn, [], "", { refetchInterval: 1000 }),
    );

    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("skips poll tick while a fetch is in flight", async () => {
    let resolveInflight: ((v: string) => void) | null = null;

    const fetchFn = vi.fn(async () => "first");

    const { result } = renderHook(() =>
      useFetch(fetchFn, [], "", { refetchInterval: 500 }),
    );

    // Initial fetch resolves immediately.
    await flush();
    expect(result.current.data).toBe("first");
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Make the next fetch hang until manually resolved.
    fetchFn.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveInflight = resolve;
        }),
    );

    // First interval tick triggers a new fetch that hangs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);

    // Another tick fires but fetch is still in flight — should be skipped.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);

    // Resolve the in-flight fetch.
    await act(async () => {
      resolveInflight!("second");
      await Promise.resolve();
    });
    expect(result.current.data).toBe("second");
  });
});

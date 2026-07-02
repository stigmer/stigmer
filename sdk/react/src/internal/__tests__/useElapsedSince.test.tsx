import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useElapsedSince, formatElapsed } from "../useElapsedSince";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-02T12:00:30Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useElapsedSince", () => {
  it("returns the elapsed ms since the timestamp", () => {
    const { result } = renderHook(() =>
      useElapsedSince("2026-07-02T12:00:00Z"),
    );
    expect(result.current).toBe(30_000);
  });

  it("ticks forward once per second", () => {
    const { result } = renderHook(() =>
      useElapsedSince("2026-07-02T12:00:00Z"),
    );
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current).toBe(33_000);
  });

  it("clamps to zero when the timestamp is ahead of the client clock", () => {
    const { result } = renderHook(() =>
      useElapsedSince("2026-07-02T12:00:35Z"),
    );
    expect(result.current).toBe(0);
  });

  it("returns null for an empty timestamp", () => {
    const { result } = renderHook(() => useElapsedSince(""));
    expect(result.current).toBeNull();
  });

  it("returns null for an unparseable timestamp", () => {
    const { result } = renderHook(() => useElapsedSince("not-a-date"));
    expect(result.current).toBeNull();
  });

  it("tears down its interval on unmount", () => {
    const { unmount } = renderHook(() =>
      useElapsedSince("2026-07-02T12:00:00Z"),
    );
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("formatElapsed", () => {
  it("formats each magnitude", () => {
    expect(formatElapsed(500)).toBe("just now");
    expect(formatElapsed(42_000)).toBe("42s");
    expect(formatElapsed(3 * 60_000 + 12_000)).toBe("3m 12s");
    expect(formatElapsed(5 * 60_000)).toBe("5m");
    expect(formatElapsed(65 * 60_000)).toBe("1h 5m");
    expect(formatElapsed(120 * 60_000)).toBe("2h");
  });
});

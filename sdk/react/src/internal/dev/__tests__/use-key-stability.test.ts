import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyStability } from "../use-key-stability";

interface KeyedItem {
  readonly key: string;
  readonly kind: string;
}

function makeItems(...specs: Array<[string, string]>): KeyedItem[] {
  return specs.map(([key, kind]) => ({ key, kind }));
}

describe("useKeyStability", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Perf logging is opt-in (off by default). Enable it via the browser
    // runtime flag so these behavioral assertions exercise the warning path.
    (globalThis as { __STIGMER_PERF__?: boolean }).__STIGMER_PERF__ = true;
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    delete (globalThis as { __STIGMER_PERF__?: boolean }).__STIGMER_PERF__;
    warnSpy.mockRestore();
  });

  it("stays silent on first render (no previous to compare)", () => {
    renderHook(() =>
      useKeyStability(makeItems(["msg-1", "message"], ["msg-2", "message"])),
    );

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("stays silent when keys are stable across renders", () => {
    const { rerender } = renderHook(
      ({ items }) => useKeyStability(items),
      {
        initialProps: {
          items: makeItems(["msg-1", "message"], ["msg-2", "message"]),
        },
      },
    );

    rerender({
      items: makeItems(["msg-1", "message"], ["msg-2", "message"]),
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("stays silent when items are appended (no swap)", () => {
    const { rerender } = renderHook(
      ({ items }) => useKeyStability(items),
      {
        initialProps: {
          items: makeItems(["msg-1", "message"]),
        },
      },
    );

    rerender({
      items: makeItems(["msg-1", "message"], ["msg-2", "message"]),
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns when a key is swapped at the same index", () => {
    const { rerender } = renderHook(
      ({ items }) => useKeyStability(items),
      {
        initialProps: {
          items: makeItems(
            ["e0-m0", "message"],
            ["e0-m1", "message"],
          ),
        },
      },
    );

    rerender({
      items: makeItems(
        ["e0-m0", "message"],
        ["e1-m0", "message"],
      ),
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain("[stgm:perf:keys]");
    expect(msg).toContain("e0-m1");
    expect(msg).toContain("e1-m0");
    expect(msg).toContain("index 1");
  });

  it("warns about widespread instability when many keys swap", () => {
    const { rerender } = renderHook(
      ({ items }) => useKeyStability(items),
      {
        initialProps: {
          items: makeItems(
            ["a", "message"],
            ["b", "message"],
            ["c", "message"],
            ["d", "message"],
          ),
        },
      },
    );

    rerender({
      items: makeItems(
        ["w", "message"],
        ["x", "message"],
        ["y", "message"],
        ["z", "message"],
      ),
    });

    const calls = warnSpy.mock.calls.map((c) => c[0] as string);
    const summaryCall = calls.find((m) => m.includes("key swaps detected"));
    expect(summaryCall).toBeDefined();
    expect(summaryCall).toContain("4 key swaps");
  });
});

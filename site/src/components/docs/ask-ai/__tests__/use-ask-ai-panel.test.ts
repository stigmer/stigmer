import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { useAskAiPanel } from "../useAskAiPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useAskAiPanel", () => {
  it("latches everOpened: closing never un-arms the embed mount", () => {
    const { result } = renderHook(() => useAskAiPanel());
    expect(result.current.everOpened).toBe(false);

    act(() => result.current.setOpen(true));
    expect(result.current.everOpened).toBe(true);

    act(() => result.current.setOpen(false));
    expect(result.current.open).toBe(false);
    // Un-latching would unmount the element and destroy the conversation.
    expect(result.current.everOpened).toBe(true);
  });

  it("retry bumps the embed epoch and re-enters connecting", () => {
    const { result } = renderHook(() => useAskAiPanel());
    act(() => result.current.setOpen(true));
    const epochBefore = result.current.embedEpoch;

    act(() => result.current.retry());

    expect(result.current.embedEpoch).toBe(epochBefore + 1);
    expect(result.current.status).toBe("connecting");
  });

  it("returns a referentially stable object across unrelated re-renders", () => {
    const { result, rerender } = renderHook(() => useAskAiPanel());
    const first = result.current;

    rerender();

    // Context consumers memoize against this object (DD-010 discipline);
    // churn here re-renders every trigger on every unrelated update.
    expect(result.current).toBe(first);
  });

  it("elementRef arms listeners whose cleanup disarms the readiness timeout", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAskAiPanel());
    const element = document.createElement("div");

    let dispose: (() => void) | undefined;
    act(() => {
      dispose = result.current.elementRef(element);
    });
    expect(typeof dispose).toBe("function");

    act(() => {
      element.dispatchEvent(new CustomEvent("stigmer:ready"));
    });
    expect(result.current.status).toBe("ready");

    // The cleared timeout must never fire and flip a ready embed back to
    // unavailable.
    act(() => {
      vi.runAllTimers();
    });
    expect(result.current.status).toBe("ready");

    dispose?.();
    vi.useRealTimers();
  });
});

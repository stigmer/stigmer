import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCopyFeedback } from "../useCopyFeedback";

describe("useCopyFeedback", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("resolves true and flashes `copied` for a successful write", async () => {
    const { result } = renderHook(() => useCopyFeedback());

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.copy("hello");
    });

    expect(outcome).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.copied).toBe(false);
  });

  it("resolves false and never claims `copied` for a rejected write", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useCopyFeedback());

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.copy("secret");
    });

    expect(outcome).toBe(false);
    expect(result.current.copied).toBe(false);
  });

  it("restarts the feedback window on a rapid second copy", async () => {
    const { result } = renderHook(() => useCopyFeedback());

    await act(async () => {
      await result.current.copy("one");
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    await act(async () => {
      await result.current.copy("two");
    });

    // 1.5s into the second window: still showing feedback.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.copied).toBe(false);
  });

  it("does not set state after unmount when the timer would fire", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useCopyFeedback());

    await act(async () => {
      await result.current.copy("bye");
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // React warns on setState-after-unmount via console.error; silence means
    // the unmount cleanup cleared the pending timer.
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useArtifactCopy } from "../useArtifactCopy";

function wrapperFor(stigmer: Stigmer) {
  return ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>
  );
}

function makeStigmer(getArtifactContent = vi.fn()) {
  return { agentExecution: { getArtifactContent } } as unknown as Stigmer;
}

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  writeText.mockClear();
  vi.stubGlobal("navigator", { clipboard: { writeText } });
});

describe("useArtifactCopy", () => {
  it("fetches content at click time and writes decoded text to the clipboard", async () => {
    const bytes = new TextEncoder().encode("# Plan\n\nsteps");
    const fn = vi.fn().mockResolvedValue({ content: bytes });
    const { result } = renderHook(() => useArtifactCopy("aex_1"), {
      wrapper: wrapperFor(makeStigmer(fn)),
    });

    expect(result.current.copied).toBe(false);
    await act(async () => {
      await result.current.copy("artifacts/aex_1/plan.md");
    });

    expect(fn).toHaveBeenCalledTimes(1);
    const req = fn.mock.calls[0][0];
    expect(req.executionId).toBe("aex_1");
    expect(req.storageKey).toBe("artifacts/aex_1/plan.md");
    expect(writeText).toHaveBeenCalledWith("# Plan\n\nsteps");
    expect(result.current.copied).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("resets the copied flag after the feedback window", async () => {
    vi.useFakeTimers();
    const bytes = new TextEncoder().encode("x");
    const fn = vi.fn().mockResolvedValue({ content: bytes });
    const { result } = renderHook(() => useArtifactCopy("aex_1"), {
      wrapper: wrapperFor(makeStigmer(fn)),
    });

    await act(async () => {
      await result.current.copy("artifacts/aex_1/plan.md");
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.copied).toBe(false);
    vi.useRealTimers();
  });

  it("is a no-op when the execution id is unknown", async () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useArtifactCopy(null), {
      wrapper: wrapperFor(makeStigmer(fn)),
    });
    await act(async () => {
      await result.current.copy("artifacts/x/plan.md");
    });
    expect(fn).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("surfaces an error when the content RPC fails", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useArtifactCopy("aex_1"), {
      wrapper: wrapperFor(makeStigmer(fn)),
    });
    await act(async () => {
      await result.current.copy("artifacts/aex_1/plan.md");
    });
    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
    expect(result.current.copied).toBe(false);
  });
});

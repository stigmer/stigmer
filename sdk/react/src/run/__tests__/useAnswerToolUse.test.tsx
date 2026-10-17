/**
 * Proves useAnswerToolUse (../useAnswerToolUse.ts): an allow or a deny goes
 * through the session's `confirmToolUse` (the deny message only with a
 * deny), a grant through `grantPermission`; the answer in flight and a
 * failure are kept per tool use (with a scalar mirror) and rethrown; a retry
 * clears only its own gate's error; the return keeps its reference.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "../../context";
import { useAnswerToolUse } from "../useAnswerToolUse";

const confirmToolUse = vi.fn();
const grantPermission = vi.fn();

const client = { session: { confirmToolUse, grantPermission } } as unknown as Stigmer;

function Wrapper({ children }: { children: ReactNode }) {
  return <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useAnswerToolUse", () => {
  it("allows through confirmToolUse, with no deny message", async () => {
    confirmToolUse.mockResolvedValueOnce({});
    const { result } = renderHook(() => useAnswerToolUse(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.answerToolUse("ses-1", "tu-1", "allow", "ignored");
    });

    expect(grantPermission).not.toHaveBeenCalled();
    expect(confirmToolUse.mock.calls[0][0]).toMatchObject({
      sessionId: "ses-1",
      toolUseId: "tu-1",
      result: "allow",
      denyMessage: "",
    });
  });

  it("denies through confirmToolUse with the person's message, or none", async () => {
    confirmToolUse.mockResolvedValue({});
    const { result } = renderHook(() => useAnswerToolUse(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.answerToolUse("ses-1", "tu-1", "deny", "use staging");
      await result.current.answerToolUse("ses-1", "tu-2", "deny");
    });

    expect(confirmToolUse.mock.calls[0][0]).toMatchObject({ result: "deny", denyMessage: "use staging" });
    expect(confirmToolUse.mock.calls[1][0]).toMatchObject({ toolUseId: "tu-2", result: "deny", denyMessage: "" });
  });

  it("grants through grantPermission", async () => {
    grantPermission.mockResolvedValueOnce({});
    const { result } = renderHook(() => useAnswerToolUse(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.answerToolUse("ses-1", "tu-1", "grant");
    });

    expect(confirmToolUse).not.toHaveBeenCalled();
    expect(grantPermission.mock.calls[0][0]).toMatchObject({ sessionId: "ses-1", toolUseId: "tu-1" });
  });

  it("tracks the tool use in flight, then releases it", async () => {
    let resolve!: () => void;
    confirmToolUse.mockReturnValueOnce(new Promise<void>((r) => (resolve = r)));
    const { result } = renderHook(() => useAnswerToolUse(), { wrapper: Wrapper });

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.answerToolUse("ses-1", "tu-1", "allow");
    });
    expect(result.current.submittingToolUseIds.has("tu-1")).toBe(true);

    await act(async () => {
      resolve();
      await pending;
    });
    expect(result.current.submittingToolUseIds.size).toBe(0);
  });

  it("keeps a failure per tool use and as a scalar, rethrows it, and clears both", async () => {
    confirmToolUse.mockRejectedValueOnce(new Error("already answered"));
    const { result } = renderHook(() => useAnswerToolUse(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.answerToolUse("ses-1", "tu-1", "allow")).rejects.toThrow(
        "already answered",
      );
    });

    expect(result.current.errorsByToolUseId.get("tu-1")?.message).toBe("already answered");
    expect(result.current.error?.message).toBe("already answered");
    expect(result.current.submittingToolUseIds.size).toBe(0);

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
    expect(result.current.errorsByToolUseId.size).toBe(0);
  });

  it("clears a gate's error when it is answered again, leaving another's", async () => {
    confirmToolUse
      .mockRejectedValueOnce(new Error("fail-a"))
      .mockRejectedValueOnce(new Error("fail-b"))
      .mockResolvedValueOnce({});
    const { result } = renderHook(() => useAnswerToolUse(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.answerToolUse("ses-1", "tu-a", "allow")).rejects.toThrow("fail-a");
    });
    await act(async () => {
      await expect(result.current.answerToolUse("ses-1", "tu-b", "deny")).rejects.toThrow("fail-b");
    });
    await act(async () => {
      await result.current.answerToolUse("ses-1", "tu-a", "allow");
    });

    expect(result.current.errorsByToolUseId.has("tu-a")).toBe(false);
    expect(result.current.errorsByToolUseId.get("tu-b")?.message).toBe("fail-b");
    expect(result.current.error).toBeNull();
  });

  it("keeps its return reference across renders when nothing changes", () => {
    const { result, rerender } = renderHook(() => useAnswerToolUse(), { wrapper: Wrapper });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

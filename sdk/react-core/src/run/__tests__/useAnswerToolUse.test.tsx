/**
 * Proves useAnswerToolUse (../useAnswerToolUse.ts): an allow or a deny goes
 * through the session's `confirmToolUse` (the deny message only with a
 * deny), a grant through `grantPermission`; the answer in flight and a
 * failure are kept per tool use (with a scalar mirror) and rethrown; a retry
 * clears only its own gate's error; the return keeps its reference. A hook
 * bound to a session (`useAnswerToolUse(sessionId)`) shows in `error` only
 * the failures of calls for that session made during this visit to it: a
 * switch starts clean, a late failure is dropped, and a call for another
 * session neither shows nor clears it (stigmer/stigmer#3226); unbound, every
 * call writes it, as before.
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
      await result.current.answerToolUse("ses_1", "tu-1", "allow", "ignored");
    });

    expect(grantPermission).not.toHaveBeenCalled();
    expect(confirmToolUse.mock.calls[0][0]).toMatchObject({
      sessionId: "ses_1",
      toolUseId: "tu-1",
      result: "allow",
      denyMessage: "",
    });
  });

  it("denies through confirmToolUse with the person's message, or none", async () => {
    confirmToolUse.mockResolvedValue({});
    const { result } = renderHook(() => useAnswerToolUse(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.answerToolUse("ses_1", "tu-1", "deny", "use staging");
      await result.current.answerToolUse("ses_1", "tu-2", "deny");
    });

    expect(confirmToolUse.mock.calls[0][0]).toMatchObject({ result: "deny", denyMessage: "use staging" });
    expect(confirmToolUse.mock.calls[1][0]).toMatchObject({ toolUseId: "tu-2", result: "deny", denyMessage: "" });
  });

  it("grants through grantPermission", async () => {
    grantPermission.mockResolvedValueOnce({});
    const { result } = renderHook(() => useAnswerToolUse(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.answerToolUse("ses_1", "tu-1", "grant");
    });

    expect(confirmToolUse).not.toHaveBeenCalled();
    expect(grantPermission.mock.calls[0][0]).toMatchObject({ sessionId: "ses_1", toolUseId: "tu-1" });
  });

  it("tracks the tool use in flight, then releases it", async () => {
    let resolve!: () => void;
    confirmToolUse.mockReturnValueOnce(new Promise<void>((r) => (resolve = r)));
    const { result } = renderHook(() => useAnswerToolUse(), { wrapper: Wrapper });

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.answerToolUse("ses_1", "tu-1", "allow");
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
      await expect(result.current.answerToolUse("ses_1", "tu-1", "allow")).rejects.toThrow(
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
      await expect(result.current.answerToolUse("ses_1", "tu-a", "allow")).rejects.toThrow("fail-a");
    });
    await act(async () => {
      await expect(result.current.answerToolUse("ses_1", "tu-b", "deny")).rejects.toThrow("fail-b");
    });
    await act(async () => {
      await result.current.answerToolUse("ses_1", "tu-a", "allow");
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

  it("bound to a session, starts clean on another and drops a failure that lands after the switch", async () => {
    confirmToolUse.mockRejectedValueOnce(new Error("fail-a"));
    let reject: (err: Error) => void = () => {};
    confirmToolUse.mockReturnValueOnce(new Promise<never>((_, r) => { reject = r; }));
    const { result, rerender } = renderHook(({ id }) => useAnswerToolUse(id), {
      wrapper: Wrapper,
      initialProps: { id: "ses_a" },
    });

    await act(async () => {
      await expect(result.current.answerToolUse("ses_a", "tu-1", "allow")).rejects.toThrow("fail-a");
    });
    expect(result.current.error?.message).toBe("fail-a");

    rerender({ id: "ses_b" });
    expect(result.current.error).toBeNull();

    rerender({ id: "ses_a" });
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.answerToolUse("ses_a", "tu-2", "allow");
    });
    rerender({ id: "ses_b" });
    await act(async () => {
      reject(new Error("too late"));
      await expect(pending).rejects.toThrow("too late");
    });
    expect(result.current.error).toBeNull();

    rerender({ id: "ses_a" });
    expect(result.current.error).toBeNull();
  });

  it("bound to a session, a call for another session neither shows its failure nor clears this one's", async () => {
    confirmToolUse
      .mockRejectedValueOnce(new Error("mine"))
      .mockRejectedValueOnce(new Error("theirs"))
      .mockResolvedValueOnce({});
    const { result } = renderHook(() => useAnswerToolUse("ses_a"), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.answerToolUse("ses_a", "tu-1", "allow")).rejects.toThrow("mine");
    });
    await act(async () => {
      await expect(result.current.answerToolUse("ses_b", "tu-2", "allow")).rejects.toThrow("theirs");
    });
    expect(result.current.error?.message).toBe("mine");
    expect(result.current.errorsByToolUseId.get("tu-2")?.message).toBe("theirs");

    await act(async () => {
      await result.current.answerToolUse("ses_b", "tu-3", "allow");
    });
    expect(result.current.error?.message).toBe("mine");
  });

  it("unbound, every call's failure shows in the scalar, as before", async () => {
    confirmToolUse.mockRejectedValueOnce(new Error("a")).mockRejectedValueOnce(new Error("b"));
    const { result } = renderHook(() => useAnswerToolUse(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.answerToolUse("ses_a", "tu-1", "allow")).rejects.toThrow("a");
    });
    expect(result.current.error?.message).toBe("a");
    await act(async () => {
      await expect(result.current.answerToolUse("ses_b", "tu-2", "allow")).rejects.toThrow("b");
    });
    expect(result.current.error?.message).toBe("b");
  });
});

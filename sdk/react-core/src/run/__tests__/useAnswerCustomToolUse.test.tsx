/**
 * Proves useAnswerCustomToolUse (../useAnswerCustomToolUse.ts): an answer
 * goes through the session's `answerCustomToolUse` as one text block, with
 * `isError` only when asked; the answer in flight and a failure are kept per
 * call (with a scalar mirror) and rethrown; a retry clears only its own
 * call's error; the return keeps its reference.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "../../context";
import { useAnswerCustomToolUse } from "../useAnswerCustomToolUse";

const answerCustomToolUse = vi.fn();

const client = { session: { answerCustomToolUse } } as unknown as Stigmer;

function Wrapper({ children }: { children: ReactNode }) {
  return <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useAnswerCustomToolUse", () => {
  it("sends the text as one text block, not an error", async () => {
    answerCustomToolUse.mockResolvedValueOnce({});
    const { result } = renderHook(() => useAnswerCustomToolUse(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.answerCustomToolUse("ses_1", "ctu-1", "Registered as acct_7Q2F");
    });

    expect(answerCustomToolUse).toHaveBeenCalledTimes(1);
    expect(answerCustomToolUse.mock.calls[0][0]).toMatchObject({
      sessionId: "ses_1",
      customToolUseId: "ctu-1",
      content: [{ type: "text", text: "Registered as acct_7Q2F" }],
      isError: false,
    });
  });

  it("marks the answer an error when asked", async () => {
    answerCustomToolUse.mockResolvedValueOnce({});
    const { result } = renderHook(() => useAnswerCustomToolUse(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.answerCustomToolUse("ses_1", "ctu-1", "The person cancelled", { isError: true });
    });

    expect(answerCustomToolUse.mock.calls[0][0]).toMatchObject({ isError: true });
  });

  it("keeps the call in flight by id until the server answers", async () => {
    let finish: (v: unknown) => void = () => {};
    answerCustomToolUse.mockReturnValueOnce(new Promise((r) => { finish = r; }));
    const { result } = renderHook(() => useAnswerCustomToolUse(), { wrapper: Wrapper });

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.answerCustomToolUse("ses_1", "ctu-1", "ok");
    });
    expect(result.current.submittingIds.has("ctu-1")).toBe(true);
    expect(result.current.submittingIds.has("ctu-2")).toBe(false);

    await act(async () => {
      finish({});
      await pending;
    });
    expect(result.current.submittingIds.size).toBe(0);
  });

  it("keeps a refusal per call and in the mirror, and rethrows it", async () => {
    answerCustomToolUse.mockRejectedValueOnce(new Error("already answered"));
    const { result } = renderHook(() => useAnswerCustomToolUse(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.answerCustomToolUse("ses_1", "ctu-1", "other")).rejects.toThrow("already answered");
    });

    expect(result.current.errorsById.get("ctu-1")?.message).toBe("already answered");
    expect(result.current.error?.message).toBe("already answered");

    act(() => result.current.clearError());
    expect(result.current.errorsById.size).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it("clears only the retried call's error", async () => {
    answerCustomToolUse.mockRejectedValueOnce(new Error("one")).mockRejectedValueOnce(new Error("two")).mockResolvedValueOnce({});
    const { result } = renderHook(() => useAnswerCustomToolUse(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.answerCustomToolUse("ses_1", "ctu-1", "a").catch(() => {});
      await result.current.answerCustomToolUse("ses_1", "ctu-2", "b").catch(() => {});
    });
    await act(async () => {
      await result.current.answerCustomToolUse("ses_1", "ctu-1", "a");
    });

    expect(result.current.errorsById.has("ctu-1")).toBe(false);
    expect(result.current.errorsById.get("ctu-2")?.message).toBe("two");
  });

  it("keeps its return's reference across renders", () => {
    const { result, rerender } = renderHook(() => useAnswerCustomToolUse(), { wrapper: Wrapper });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

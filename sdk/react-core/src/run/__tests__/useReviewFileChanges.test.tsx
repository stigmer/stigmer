/**
 * Proves useReviewFileChanges (../useReviewFileChanges.ts): a decision goes
 * through the session's `reviewFileChanges` — the whole set by default, one
 * file when a file id is given (or when the scope says so), bound to the
 * digest the person saw, with its reason and binary acknowledgment; the
 * decision in flight and a failure are kept per decision key (with a scalar
 * mirror) and rethrown; a retry or `clearDecisionError` clears only its own
 * key; `fileDecisionKey` names a whole set or one file. A hook bound to a
 * session (`useReviewFileChanges(sessionId)`) shows in `error` only the
 * failures of decisions for that session made during this visit to it: a
 * switch starts clean, a late failure is dropped, and a decision for another
 * session neither shows nor clears it (stigmer/stigmer#3226); unbound, every
 * decision writes it, as before.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "../../context";
import { useReviewFileChanges, fileDecisionKey } from "../useReviewFileChanges";

const reviewFileChanges = vi.fn();

const client = { session: { reviewFileChanges } } as unknown as Stigmer;

function Wrapper({ children }: { children: ReactNode }) {
  return <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fileDecisionKey", () => {
  it("is the set's id for the whole set, setId:fileChangeId for one file", () => {
    expect(fileDecisionKey("cs-1")).toBe("cs-1");
    expect(fileDecisionKey("cs-1", "fc-1")).toBe("cs-1:fc-1");
  });
});

describe("useReviewFileChanges", () => {
  it("decides the whole set by default, bound to the aggregate digest", async () => {
    reviewFileChanges.mockResolvedValueOnce({});
    const { result } = renderHook(() => useReviewFileChanges(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.reviewFileChanges("ses_1", "cs-1", "keep", { expectedDigest: "agg-1" });
    });

    expect(reviewFileChanges.mock.calls[0][0]).toMatchObject({
      sessionId: "ses_1",
      changeSetId: "cs-1",
      scope: "change_set",
      fileChangeId: "",
      action: "keep",
      expectedDigest: "agg-1",
      reason: "",
      acknowledgeUnreviewable: false,
    });
  });

  it("decides one file when a file id is given, with its reason and acknowledgment", async () => {
    reviewFileChanges.mockResolvedValue({});
    const { result } = renderHook(() => useReviewFileChanges(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.reviewFileChanges("ses_1", "cs-1", "keep", {
        fileChangeId: "fc-bin",
        expectedDigest: "d-bin",
        reason: "it is the logo",
        acknowledgeUnreviewable: true,
      });
      await result.current.reviewFileChanges("ses_1", "cs-1", "undo", {
        scope: "change_set",
        fileChangeId: "fc-2",
        expectedDigest: "agg",
      });
    });

    expect(reviewFileChanges.mock.calls[0][0]).toMatchObject({
      scope: "file",
      fileChangeId: "fc-bin",
      action: "keep",
      expectedDigest: "d-bin",
      reason: "it is the logo",
      acknowledgeUnreviewable: true,
    });
    expect(reviewFileChanges.mock.calls[1][0]).toMatchObject({ scope: "change_set", action: "undo" });
  });

  it("tracks the decision key in flight, then releases it", async () => {
    let resolve!: () => void;
    reviewFileChanges.mockReturnValueOnce(new Promise<void>((r) => (resolve = r)));
    const { result } = renderHook(() => useReviewFileChanges(), { wrapper: Wrapper });

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.reviewFileChanges("ses_1", "cs-1", "keep", { expectedDigest: "agg" });
    });
    expect(result.current.submittingDecisionKeys.has("cs-1")).toBe(true);

    await act(async () => {
      resolve();
      await pending;
    });
    expect(result.current.submittingDecisionKeys.size).toBe(0);
  });

  it("keeps a failure under its key and as a scalar, rethrows it, and clears both", async () => {
    reviewFileChanges.mockRejectedValueOnce(new Error("digest mismatch"));
    const { result } = renderHook(() => useReviewFileChanges(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.reviewFileChanges("ses_1", "cs-1", "keep", { expectedDigest: "agg" }),
      ).rejects.toThrow("digest mismatch");
    });

    expect(result.current.decisionErrors.get("cs-1")?.message).toBe("digest mismatch");
    expect(result.current.error?.message).toBe("digest mismatch");
    expect(result.current.submittingDecisionKeys.size).toBe(0);

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
    expect(result.current.decisionErrors.size).toBe(0);
  });

  it("clears one key on a retry and via clearDecisionError, leaving the others", async () => {
    reviewFileChanges
      .mockRejectedValueOnce(new Error("fail-a"))
      .mockRejectedValueOnce(new Error("fail-b"))
      .mockResolvedValueOnce({});
    const { result } = renderHook(() => useReviewFileChanges(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.reviewFileChanges("ses_1", "cs-1", "undo", { fileChangeId: "fc1", expectedDigest: "d1" }),
      ).rejects.toThrow("fail-a");
    });
    await act(async () => {
      await expect(
        result.current.reviewFileChanges("ses_1", "cs-1", "undo", { fileChangeId: "fc2", expectedDigest: "d2" }),
      ).rejects.toThrow("fail-b");
    });
    await act(async () => {
      await result.current.reviewFileChanges("ses_1", "cs-1", "keep", { fileChangeId: "fc1", expectedDigest: "d1" });
    });

    const keyA = fileDecisionKey("cs-1", "fc1");
    const keyB = fileDecisionKey("cs-1", "fc2");
    expect(result.current.decisionErrors.has(keyA)).toBe(false);
    expect(result.current.decisionErrors.get(keyB)?.message).toBe("fail-b");

    act(() => result.current.clearDecisionError("absent"));
    act(() => result.current.clearDecisionError(keyB));
    expect(result.current.decisionErrors.size).toBe(0);
  });

  it("bound to a session, starts clean on another and drops a failure that lands after the switch", async () => {
    reviewFileChanges.mockRejectedValueOnce(new Error("fail-a"));
    let reject: (err: Error) => void = () => {};
    reviewFileChanges.mockReturnValueOnce(new Promise<never>((_, r) => { reject = r; }));
    const { result, rerender } = renderHook(({ id }) => useReviewFileChanges(id), {
      wrapper: Wrapper,
      initialProps: { id: "ses_a" },
    });

    await act(async () => {
      await expect(result.current.reviewFileChanges("ses_a", "cs-1", "keep", { expectedDigest: "d" })).rejects.toThrow("fail-a");
    });
    expect(result.current.error?.message).toBe("fail-a");

    rerender({ id: "ses_b" });
    expect(result.current.error).toBeNull();

    rerender({ id: "ses_a" });
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.reviewFileChanges("ses_a", "cs-2", "undo", { expectedDigest: "d" });
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

  it("bound to a session, a decision for another session neither shows its failure nor clears this one's", async () => {
    reviewFileChanges
      .mockRejectedValueOnce(new Error("mine"))
      .mockRejectedValueOnce(new Error("theirs"))
      .mockResolvedValueOnce({});
    const { result } = renderHook(() => useReviewFileChanges("ses_a"), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.reviewFileChanges("ses_a", "cs-1", "keep", { expectedDigest: "d" })).rejects.toThrow("mine");
    });
    await act(async () => {
      await expect(result.current.reviewFileChanges("ses_b", "cs-2", "keep", { expectedDigest: "d" })).rejects.toThrow("theirs");
    });
    expect(result.current.error?.message).toBe("mine");
    expect(result.current.decisionErrors.get("cs-2")?.message).toBe("theirs");

    await act(async () => {
      await result.current.reviewFileChanges("ses_b", "cs-3", "keep", { expectedDigest: "d" });
    });
    expect(result.current.error?.message).toBe("mine");
  });

  it("unbound, every decision's failure shows in the scalar, as before", async () => {
    reviewFileChanges.mockRejectedValueOnce(new Error("a")).mockRejectedValueOnce(new Error("b"));
    const { result } = renderHook(() => useReviewFileChanges(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.reviewFileChanges("ses_a", "cs-1", "keep", { expectedDigest: "d" })).rejects.toThrow("a");
    });
    expect(result.current.error?.message).toBe("a");
    await act(async () => {
      await expect(result.current.reviewFileChanges("ses_b", "cs-2", "keep", { expectedDigest: "d" })).rejects.toThrow("b");
    });
    expect(result.current.error?.message).toBe("b");
  });
});

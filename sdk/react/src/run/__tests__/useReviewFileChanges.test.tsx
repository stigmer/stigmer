/**
 * Proves useReviewFileChanges (../useReviewFileChanges.ts): a decision goes
 * through the session's `reviewFileChanges` — the whole set by default, one
 * file when a file id is given (or when the scope says so), bound to the
 * digest the person saw, with its reason and binary acknowledgment; the
 * decision in flight and a failure are kept per decision key (with a scalar
 * mirror) and rethrown; a retry or `clearDecisionError` clears only its own
 * key; `fileDecisionKey` names a whole set or one file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
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
      await result.current.reviewFileChanges("ses-1", "cs-1", "keep", { expectedDigest: "agg-1" });
    });

    expect(reviewFileChanges.mock.calls[0][0]).toMatchObject({
      sessionId: "ses-1",
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
      await result.current.reviewFileChanges("ses-1", "cs-1", "keep", {
        fileChangeId: "fc-bin",
        expectedDigest: "d-bin",
        reason: "it is the logo",
        acknowledgeUnreviewable: true,
      });
      await result.current.reviewFileChanges("ses-1", "cs-1", "undo", {
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
      pending = result.current.reviewFileChanges("ses-1", "cs-1", "keep", { expectedDigest: "agg" });
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
        result.current.reviewFileChanges("ses-1", "cs-1", "keep", { expectedDigest: "agg" }),
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
        result.current.reviewFileChanges("ses-1", "cs-1", "undo", { fileChangeId: "fc1", expectedDigest: "d1" }),
      ).rejects.toThrow("fail-a");
    });
    await act(async () => {
      await expect(
        result.current.reviewFileChanges("ses-1", "cs-1", "undo", { fileChangeId: "fc2", expectedDigest: "d2" }),
      ).rejects.toThrow("fail-b");
    });
    await act(async () => {
      await result.current.reviewFileChanges("ses-1", "cs-1", "keep", { fileChangeId: "fc1", expectedDigest: "d1" });
    });

    const keyA = fileDecisionKey("cs-1", "fc1");
    const keyB = fileDecisionKey("cs-1", "fc2");
    expect(result.current.decisionErrors.has(keyA)).toBe(false);
    expect(result.current.decisionErrors.get(keyB)?.message).toBe("fail-b");

    act(() => result.current.clearDecisionError("absent"));
    act(() => result.current.clearDecisionError(keyB));
    expect(result.current.decisionErrors.size).toBe(0);
  });
});

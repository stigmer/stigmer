import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import {
  FileDecisionAction,
  FileDecisionScope,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { StigmerContext } from "../../context";
import { useFileReview, fileDecisionKey } from "../useFileReview";

const mockSubmitFileDecision = vi.fn();

function makeMockClient(): Stigmer {
  return {
    agentExecution: { submitFileDecision: mockSubmitFileDecision },
  } as unknown as Stigmer;
}

function createWrapper(client: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useFileReview", () => {
  it("submits a whole-set decision as CHANGE_SET scope bound to the aggregate digest", async () => {
    mockSubmitFileDecision.mockResolvedValueOnce({});

    const { result } = renderHook(() => useFileReview(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.submitFileDecision("aex-1", "aex-1:0", FileDecisionAction.APPROVE, {
        expectedDigest: "agg-1",
      });
    });

    expect(mockSubmitFileDecision).toHaveBeenCalledTimes(1);
    expect(mockSubmitFileDecision.mock.calls[0][0]).toMatchObject({
      agentExecutionId: "aex-1",
      changeSetId: "aex-1:0",
      scope: FileDecisionScope.CHANGE_SET,
      fileChangeId: "",
      action: FileDecisionAction.APPROVE,
      expectedDigest: "agg-1",
    });
  });

  it("defaults to FILE scope when a fileChangeId is supplied", async () => {
    mockSubmitFileDecision.mockResolvedValueOnce({});

    const { result } = renderHook(() => useFileReview(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.submitFileDecision("aex-1", "aex-1:0", FileDecisionAction.REJECT, {
        fileChangeId: "aex-1:0:src/a.ts",
        expectedDigest: "file-1",
      });
    });

    expect(mockSubmitFileDecision.mock.calls[0][0]).toMatchObject({
      scope: FileDecisionScope.FILE,
      fileChangeId: "aex-1:0:src/a.ts",
      action: FileDecisionAction.REJECT,
      expectedDigest: "file-1",
    });
  });

  it("tracks submitting decision keys while in flight, then clears them", async () => {
    let resolve!: () => void;
    mockSubmitFileDecision.mockReturnValueOnce(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );

    const { result } = renderHook(() => useFileReview(), {
      wrapper: createWrapper(makeMockClient()),
    });

    let pending: Promise<void>;
    act(() => {
      pending = result.current.submitFileDecision("aex-1", "aex-1:0", FileDecisionAction.APPROVE);
    });

    expect(result.current.submittingDecisionKeys.has(fileDecisionKey("aex-1:0"))).toBe(true);

    await act(async () => {
      resolve();
      await pending;
    });

    expect(result.current.submittingDecisionKeys.size).toBe(0);
  });

  it("surfaces the error and rethrows on failure, keyed by the whole-set key", async () => {
    mockSubmitFileDecision.mockRejectedValueOnce(new Error("digest mismatch"));

    const { result } = renderHook(() => useFileReview(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await expect(
        result.current.submitFileDecision("aex-1", "aex-1:0", FileDecisionAction.APPROVE),
      ).rejects.toThrow("digest mismatch");
    });

    // Scalar mirror (single-error consumers).
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe("digest mismatch");
    // Keyed map (per-control surfacing) — under the whole-set key.
    expect(result.current.decisionErrors.get(fileDecisionKey("aex-1:0"))?.message).toBe(
      "digest mismatch",
    );
    expect(result.current.submittingDecisionKeys.size).toBe(0);

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
    expect(result.current.decisionErrors.size).toBe(0);
  });

  it("keys a per-file failure under setId:fileChangeId, leaving other keys untouched", async () => {
    mockSubmitFileDecision.mockRejectedValueOnce(new Error("network down"));

    const { result } = renderHook(() => useFileReview(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await expect(
        result.current.submitFileDecision("aex-1", "aex-1:0", FileDecisionAction.REJECT, {
          fileChangeId: "fc1",
        }),
      ).rejects.toThrow("network down");
    });

    const perFileKey = fileDecisionKey("aex-1:0", "fc1");
    expect(result.current.decisionErrors.get(perFileKey)?.message).toBe("network down");
    // The whole-set key (and any other file) is unaffected.
    expect(result.current.decisionErrors.has(fileDecisionKey("aex-1:0"))).toBe(false);
  });

  it("clears one key on a retry-start and via clearDecisionError, without touching siblings", async () => {
    mockSubmitFileDecision
      .mockRejectedValueOnce(new Error("fail-a"))
      .mockRejectedValueOnce(new Error("fail-b"));

    const { result } = renderHook(() => useFileReview(), {
      wrapper: createWrapper(makeMockClient()),
    });

    // Two distinct files fail.
    await act(async () => {
      await expect(
        result.current.submitFileDecision("aex-1", "aex-1:0", FileDecisionAction.REJECT, {
          fileChangeId: "fc1",
        }),
      ).rejects.toThrow("fail-a");
    });
    await act(async () => {
      await expect(
        result.current.submitFileDecision("aex-1", "aex-1:0", FileDecisionAction.REJECT, {
          fileChangeId: "fc2",
        }),
      ).rejects.toThrow("fail-b");
    });

    const keyA = fileDecisionKey("aex-1:0", "fc1");
    const keyB = fileDecisionKey("aex-1:0", "fc2");
    expect(result.current.decisionErrors.get(keyA)?.message).toBe("fail-a");
    expect(result.current.decisionErrors.get(keyB)?.message).toBe("fail-b");

    // Retrying fc1 succeeds: its error clears at submit-start, fc2's stays.
    mockSubmitFileDecision.mockResolvedValueOnce({});
    await act(async () => {
      await result.current.submitFileDecision("aex-1", "aex-1:0", FileDecisionAction.APPROVE, {
        fileChangeId: "fc1",
      });
    });
    expect(result.current.decisionErrors.has(keyA)).toBe(false);
    expect(result.current.decisionErrors.get(keyB)?.message).toBe("fail-b");

    // clearDecisionError removes only the targeted key.
    act(() => result.current.clearDecisionError(keyB));
    expect(result.current.decisionErrors.size).toBe(0);
  });
});

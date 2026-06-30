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

  it("surfaces the error and rethrows on failure", async () => {
    mockSubmitFileDecision.mockRejectedValueOnce(new Error("digest mismatch"));

    const { result } = renderHook(() => useFileReview(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await expect(
        result.current.submitFileDecision("aex-1", "aex-1:0", FileDecisionAction.APPROVE),
      ).rejects.toThrow("digest mismatch");
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe("digest mismatch");
    expect(result.current.submittingDecisionKeys.size).toBe(0);

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});

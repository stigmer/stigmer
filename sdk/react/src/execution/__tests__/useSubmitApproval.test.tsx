import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { StigmerContext } from "../../context";
import { useSubmitApproval } from "../useSubmitApproval";

const mockSubmitApproval = vi.fn();

function makeMockClient(): Stigmer {
  return {
    agentExecution: { submitApproval: mockSubmitApproval },
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

describe("useSubmitApproval", () => {
  it("forwards the decision with the bound execution + tool call ids", async () => {
    mockSubmitApproval.mockResolvedValueOnce({});

    const { result } = renderHook(() => useSubmitApproval(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.submitApproval("aex-1", "tc-1", ApprovalAction.APPROVE, "ok");
    });

    expect(mockSubmitApproval).toHaveBeenCalledTimes(1);
    expect(mockSubmitApproval.mock.calls[0][0]).toMatchObject({
      agentExecutionId: "aex-1",
      toolCallId: "tc-1",
      action: ApprovalAction.APPROVE,
      comment: "ok",
    });
  });

  it("tracks submitting tool-call ids while in flight, then clears them", async () => {
    let resolve!: () => void;
    mockSubmitApproval.mockReturnValueOnce(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );

    const { result } = renderHook(() => useSubmitApproval(), {
      wrapper: createWrapper(makeMockClient()),
    });

    let pending: Promise<void>;
    act(() => {
      pending = result.current.submitApproval("aex-1", "tc-1", ApprovalAction.APPROVE);
    });

    expect(result.current.submittingToolCallIds.has("tc-1")).toBe(true);

    await act(async () => {
      resolve();
      await pending;
    });

    expect(result.current.submittingToolCallIds.size).toBe(0);
  });

  it("records the failure keyed by tool call id (and the scalar mirror), then rethrows", async () => {
    mockSubmitApproval.mockRejectedValueOnce(new Error("gate already resolved"));

    const { result } = renderHook(() => useSubmitApproval(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await expect(
        result.current.submitApproval("aex-1", "tc-1", ApprovalAction.APPROVE),
      ).rejects.toThrow("gate already resolved");
    });

    // Keyed map (per-gate surfacing).
    expect(result.current.errorsByToolCallId.get("tc-1")?.message).toBe(
      "gate already resolved",
    );
    // Scalar mirror (single-error / ink consumers).
    expect(result.current.error?.message).toBe("gate already resolved");
    // In-flight state is released even on failure.
    expect(result.current.submittingToolCallIds.size).toBe(0);

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
    expect(result.current.errorsByToolCallId.size).toBe(0);
  });

  it("keys two failures independently — one gate's error never clobbers another", async () => {
    mockSubmitApproval
      .mockRejectedValueOnce(new Error("fail-a"))
      .mockRejectedValueOnce(new Error("fail-b"));

    const { result } = renderHook(() => useSubmitApproval(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await expect(
        result.current.submitApproval("aex-1", "tc-a", ApprovalAction.APPROVE),
      ).rejects.toThrow("fail-a");
    });
    await act(async () => {
      await expect(
        result.current.submitApproval("aex-1", "tc-b", ApprovalAction.REJECT),
      ).rejects.toThrow("fail-b");
    });

    expect(result.current.errorsByToolCallId.get("tc-a")?.message).toBe("fail-a");
    expect(result.current.errorsByToolCallId.get("tc-b")?.message).toBe("fail-b");
  });

  it("clears a gate's prior error at retry-start, leaving siblings untouched", async () => {
    mockSubmitApproval
      .mockRejectedValueOnce(new Error("fail-a"))
      .mockRejectedValueOnce(new Error("fail-b"));

    const { result } = renderHook(() => useSubmitApproval(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await expect(
        result.current.submitApproval("aex-1", "tc-a", ApprovalAction.APPROVE),
      ).rejects.toThrow("fail-a");
    });
    await act(async () => {
      await expect(
        result.current.submitApproval("aex-1", "tc-b", ApprovalAction.APPROVE),
      ).rejects.toThrow("fail-b");
    });

    // Retrying tc-a succeeds: its error clears at submit-start; tc-b's persists.
    mockSubmitApproval.mockResolvedValueOnce({});
    await act(async () => {
      await result.current.submitApproval("aex-1", "tc-a", ApprovalAction.APPROVE);
    });

    expect(result.current.errorsByToolCallId.has("tc-a")).toBe(false);
    expect(result.current.errorsByToolCallId.get("tc-b")?.message).toBe("fail-b");
  });

  it("keeps a stable return reference across renders when nothing changes", () => {
    const { result, rerender } = renderHook(() => useSubmitApproval(), {
      wrapper: createWrapper(makeMockClient()),
    });

    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

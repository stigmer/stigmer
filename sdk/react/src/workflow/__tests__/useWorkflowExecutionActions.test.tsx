import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useWorkflowExecutionActions } from "../useWorkflowExecutionActions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExecution(id = "wex-001", phase = 2 /* IN_PROGRESS */) {
  return {
    metadata: { id, name: "test-execution", org: "org-1" },
    status: { phase },
  } as any;
}

const mockCancel = vi.fn();
const mockTerminate = vi.fn();
const mockPause = vi.fn();
const mockResume = vi.fn();
const mockRecover = vi.fn();
const mockSubmitApproval = vi.fn();
const mockSubmitWorkflowTaskApproval = vi.fn();
const mockSubmitFileDecision = vi.fn();

function makeMockClient(): Stigmer {
  return {
    workflowExecution: {
      cancel: mockCancel,
      terminate: mockTerminate,
      pause: mockPause,
      resume: mockResume,
      recover: mockRecover,
      submitApproval: mockSubmitApproval,
      submitWorkflowTaskApproval: mockSubmitWorkflowTaskApproval,
      submitFileDecision: mockSubmitFileDecision,
    },
  } as unknown as Stigmer;
}

function createWrapper(client: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client}>
        {children}
      </StigmerContext.Provider>
    );
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Lifecycle actions (cancel, pause, resume, recover)
// ---------------------------------------------------------------------------

describe("useWorkflowExecutionActions", () => {
  it("cancel returns updated execution on success", async () => {
    const execution = makeExecution("wex-001", 5 /* CANCELLED */);
    mockCancel.mockResolvedValueOnce(execution);

    const { result } = renderHook(
      () => useWorkflowExecutionActions("wex-001"),
      { wrapper: createWrapper(makeMockClient()) },
    );

    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.error).toBeNull();

    let returned: any;
    await act(async () => {
      returned = await result.current.cancel("No longer needed");
    });

    expect(returned).toBe(execution);
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it("recover returns updated execution on success", async () => {
    const execution = makeExecution("wex-001", 2 /* IN_PROGRESS */);
    mockRecover.mockResolvedValueOnce(execution);

    const { result } = renderHook(
      () => useWorkflowExecutionActions("wex-001"),
      { wrapper: createWrapper(makeMockClient()) },
    );

    let returned: any;
    await act(async () => {
      returned = await result.current.recover("Retry after fix");
    });

    expect(returned).toBe(execution);
    expect(result.current.error).toBeNull();
    expect(mockRecover).toHaveBeenCalledTimes(1);
  });

  it("sets error and returns null on failure", async () => {
    mockCancel.mockRejectedValueOnce(new Error("Temporal not found"));

    const { result } = renderHook(
      () => useWorkflowExecutionActions("wex-001"),
      { wrapper: createWrapper(makeMockClient()) },
    );

    let returned: any;
    await act(async () => {
      returned = await result.current.cancel();
    });

    expect(returned).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe("Temporal not found");
    expect(result.current.isSubmitting).toBe(false);
  });

  it("clearError resets error to null", async () => {
    mockPause.mockRejectedValueOnce(new Error("oops"));

    const { result } = renderHook(
      () => useWorkflowExecutionActions("wex-001"),
      { wrapper: createWrapper(makeMockClient()) },
    );

    await act(async () => {
      await result.current.pause();
    });
    expect(result.current.error).not.toBeNull();

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it("error is cleared on next action attempt", async () => {
    mockRecover
      .mockRejectedValueOnce(new Error("first attempt failed"))
      .mockResolvedValueOnce(makeExecution());

    const { result } = renderHook(
      () => useWorkflowExecutionActions("wex-001"),
      { wrapper: createWrapper(makeMockClient()) },
    );

    await act(async () => {
      await result.current.recover();
    });
    expect(result.current.error!.message).toBe("first attempt failed");

    await act(async () => {
      await result.current.recover();
    });
    expect(result.current.error).toBeNull();
  });

  it("null executionId returns null without calling SDK", async () => {
    const { result } = renderHook(
      () => useWorkflowExecutionActions(null),
      { wrapper: createWrapper(makeMockClient()) },
    );

    let returned: any;
    await act(async () => {
      returned = await result.current.cancel();
    });

    expect(returned).toBeNull();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// onSuccess callback
// ---------------------------------------------------------------------------

describe("onSuccess callback", () => {
  it("fires after successful lifecycle action", async () => {
    const execution = makeExecution("wex-001", 5);
    mockCancel.mockResolvedValueOnce(execution);
    const onSuccess = vi.fn();

    const { result } = renderHook(
      () => useWorkflowExecutionActions("wex-001", { onSuccess }),
      { wrapper: createWrapper(makeMockClient()) },
    );

    await act(async () => {
      await result.current.cancel();
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(execution);
  });

  it("does not fire on failure", async () => {
    mockCancel.mockRejectedValueOnce(new Error("fail"));
    const onSuccess = vi.fn();

    const { result } = renderHook(
      () => useWorkflowExecutionActions("wex-001", { onSuccess }),
      { wrapper: createWrapper(makeMockClient()) },
    );

    await act(async () => {
      await result.current.cancel();
    });

    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("does not fire for submitApproval", async () => {
    mockSubmitApproval.mockResolvedValueOnce(makeExecution());
    const onSuccess = vi.fn();

    const { result } = renderHook(
      () => useWorkflowExecutionActions("wex-001", { onSuccess }),
      { wrapper: createWrapper(makeMockClient()) },
    );

    await act(async () => {
      await result.current.submitApproval("tc-1", 1 as any);
    });

    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("does not fire for submitTaskApproval", async () => {
    mockSubmitWorkflowTaskApproval.mockResolvedValueOnce(makeExecution());
    const onSuccess = vi.fn();

    const { result } = renderHook(
      () => useWorkflowExecutionActions("wex-001", { onSuccess }),
      { wrapper: createWrapper(makeMockClient()) },
    );

    await act(async () => {
      await result.current.submitTaskApproval("review_task", "approved");
    });

    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("fires for each lifecycle action type", async () => {
    const onSuccess = vi.fn();
    const wrapper = createWrapper(makeMockClient());

    for (const [action, mock] of [
      ["cancel", mockCancel],
      ["terminate", mockTerminate],
      ["pause", mockPause],
      ["resume", mockResume],
      ["recover", mockRecover],
    ] as const) {
      vi.clearAllMocks();
      const exec = makeExecution("wex-001");
      mock.mockResolvedValueOnce(exec);

      const { result } = renderHook(
        () => useWorkflowExecutionActions("wex-001", { onSuccess }),
        { wrapper },
      );

      await act(async () => {
        if (action === "resume") {
          await result.current[action]();
        } else {
          await result.current[action]("test reason");
        }
      });

      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith(exec);
    }
  });
});

// ---------------------------------------------------------------------------
// Per-gate approval state (keyed; separate from the lifecycle scalar)
// ---------------------------------------------------------------------------

describe("per-gate approval state", () => {
  it("tracks an in-flight tool approval keyed by toolCallId, not the lifecycle scalar", async () => {
    let resolve!: (v: unknown) => void;
    mockSubmitApproval.mockReturnValueOnce(new Promise((r) => (resolve = r)));

    const { result } = renderHook(
      () => useWorkflowExecutionActions("wex-001"),
      { wrapper: createWrapper(makeMockClient()) },
    );

    let pending: Promise<unknown>;
    act(() => {
      pending = result.current.submitApproval("tc-1", 1 as any);
    });

    expect(result.current.approvalSubmittingToolCallIds.has("tc-1")).toBe(true);
    // The lifecycle scalar is untouched by an approval.
    expect(result.current.isSubmitting).toBe(false);

    await act(async () => {
      resolve(makeExecution());
      await pending;
    });

    expect(result.current.approvalSubmittingToolCallIds.size).toBe(0);
  });

  it("records a failed tool approval in the keyed map, not the lifecycle scalar, and resolves null", async () => {
    mockSubmitApproval.mockRejectedValueOnce(new Error("gate already resolved"));

    const { result } = renderHook(
      () => useWorkflowExecutionActions("wex-001"),
      { wrapper: createWrapper(makeMockClient()) },
    );

    let returned: any;
    await act(async () => {
      returned = await result.current.submitApproval("tc-1", 1 as any);
    });

    expect(returned).toBeNull();
    expect(result.current.approvalErrorsByToolCallId.get("tc-1")?.message).toBe(
      "gate already resolved",
    );
    // The lifecycle scalar (header banner) must NOT pick up an approval failure.
    expect(result.current.error).toBeNull();
    expect(result.current.isSubmitting).toBe(false);
  });

  it("records a failed task approval keyed by taskName, not the lifecycle scalar", async () => {
    mockSubmitWorkflowTaskApproval.mockRejectedValueOnce(new Error("signal failed"));

    const { result } = renderHook(
      () => useWorkflowExecutionActions("wex-001"),
      { wrapper: createWrapper(makeMockClient()) },
    );

    let returned: any;
    await act(async () => {
      returned = await result.current.submitTaskApproval("review_task", "approved");
    });

    expect(returned).toBeNull();
    expect(result.current.taskApprovalErrorsByTaskName.get("review_task")?.message).toBe(
      "signal failed",
    );
    expect(result.current.error).toBeNull();
  });

  it("keeps tool and task approval errors in separate keyed spaces", async () => {
    mockSubmitApproval.mockRejectedValueOnce(new Error("tool fail"));
    mockSubmitWorkflowTaskApproval.mockRejectedValueOnce(new Error("task fail"));

    const { result } = renderHook(
      () => useWorkflowExecutionActions("wex-001"),
      { wrapper: createWrapper(makeMockClient()) },
    );

    await act(async () => {
      await result.current.submitApproval("tc-1", 1 as any);
    });
    await act(async () => {
      await result.current.submitTaskApproval("review_task", "approved");
    });

    expect(result.current.approvalErrorsByToolCallId.get("tc-1")?.message).toBe("tool fail");
    expect(result.current.taskApprovalErrorsByTaskName.get("review_task")?.message).toBe("task fail");
    // Neither keyed failure crosses into the other space or the scalar.
    expect(result.current.approvalErrorsByToolCallId.has("review_task")).toBe(false);
    expect(result.current.taskApprovalErrorsByTaskName.has("tc-1")).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("keeps a failed lifecycle action in the scalar, never in the keyed approval maps", async () => {
    mockCancel.mockRejectedValueOnce(new Error("temporal down"));

    const { result } = renderHook(
      () => useWorkflowExecutionActions("wex-001"),
      { wrapper: createWrapper(makeMockClient()) },
    );

    await act(async () => {
      await result.current.cancel();
    });

    expect(result.current.error?.message).toBe("temporal down");
    expect(result.current.approvalErrorsByToolCallId.size).toBe(0);
    expect(result.current.taskApprovalErrorsByTaskName.size).toBe(0);
  });

  it("null executionId returns null without recording keyed state", async () => {
    const { result } = renderHook(
      () => useWorkflowExecutionActions(null),
      { wrapper: createWrapper(makeMockClient()) },
    );

    let returned: any;
    await act(async () => {
      returned = await result.current.submitApproval("tc-1", 1 as any);
    });

    expect(returned).toBeNull();
    expect(mockSubmitApproval).not.toHaveBeenCalled();
    expect(result.current.approvalSubmittingToolCallIds.size).toBe(0);
    expect(result.current.approvalErrorsByToolCallId.size).toBe(0);
  });

  it("keeps a stable return reference across renders when nothing changes", () => {
    const { result, rerender } = renderHook(
      () => useWorkflowExecutionActions("wex-001"),
      { wrapper: createWrapper(makeMockClient()) },
    );

    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// Per-gate file-decision state (forwarding + keyed like FileReviewCard)
// ---------------------------------------------------------------------------

describe("submitFileDecision (workflow-parent file review)", () => {
  it("forwards a CHANGE_SET decision with explicit child routing", async () => {
    mockSubmitFileDecision.mockResolvedValueOnce(makeExecution());

    const { result } = renderHook(
      () => useWorkflowExecutionActions("wex-001"),
      { wrapper: createWrapper(makeMockClient()) },
    );

    await act(async () => {
      await result.current.submitFileDecision("aex-child", "fcs-1", 1 /* APPROVE */ as any, {
        expectedDigest: "sha256:agg",
      });
    });

    expect(mockSubmitFileDecision).toHaveBeenCalledTimes(1);
    const input = mockSubmitFileDecision.mock.calls[0][0];
    expect(input.executionId).toBe("wex-001");
    expect(input.childAgentExecutionId).toBe("aex-child");
    expect(input.changeSetId).toBe("fcs-1");
    expect(input.scope).toBe(1 /* CHANGE_SET */);
    expect(input.fileChangeId).toBe("");
    expect(input.action).toBe(1 /* APPROVE */);
    expect(input.expectedDigest).toBe("sha256:agg");
  });

  it("derives FILE scope when a fileChangeId is supplied", async () => {
    mockSubmitFileDecision.mockResolvedValueOnce(makeExecution());

    const { result } = renderHook(
      () => useWorkflowExecutionActions("wex-001"),
      { wrapper: createWrapper(makeMockClient()) },
    );

    await act(async () => {
      await result.current.submitFileDecision("aex-child", "fcs-1", 2 /* REJECT */ as any, {
        fileChangeId: "fc-9",
        expectedDigest: "sha256:file",
      });
    });

    const input = mockSubmitFileDecision.mock.calls[0][0];
    expect(input.scope).toBe(2 /* FILE */);
    expect(input.fileChangeId).toBe("fc-9");
    expect(input.action).toBe(2 /* REJECT */);
  });

  it("tracks in-flight state keyed like FileReviewCard (changeSetId, then changeSetId:fileChangeId)", async () => {
    let resolve!: (v: unknown) => void;
    mockSubmitFileDecision.mockReturnValueOnce(new Promise((r) => (resolve = r)));

    const { result } = renderHook(
      () => useWorkflowExecutionActions("wex-001"),
      { wrapper: createWrapper(makeMockClient()) },
    );

    let pending: Promise<unknown>;
    act(() => {
      pending = result.current.submitFileDecision("aex-child", "fcs-1", 1 as any);
    });

    expect(result.current.fileDecisionSubmittingKeys.has("fcs-1")).toBe(true);
    expect(result.current.isSubmitting).toBe(false); // lifecycle scalar untouched

    await act(async () => {
      resolve(makeExecution());
      await pending;
    });

    expect(result.current.fileDecisionSubmittingKeys.size).toBe(0);
  });

  it("records a failed decision in the keyed map (not the scalar) and resolves null", async () => {
    mockSubmitFileDecision.mockRejectedValueOnce(new Error("expected_digest mismatch"));

    const { result } = renderHook(
      () => useWorkflowExecutionActions("wex-001"),
      { wrapper: createWrapper(makeMockClient()) },
    );

    let returned: any;
    await act(async () => {
      returned = await result.current.submitFileDecision("aex-child", "fcs-1", 1 as any, {
        fileChangeId: "fc-9",
      });
    });

    expect(returned).toBeNull();
    expect(result.current.fileDecisionErrorsByKey.get("fcs-1:fc-9")?.message).toBe(
      "expected_digest mismatch",
    );
    expect(result.current.error).toBeNull(); // header banner unaffected
  });

  it("does not fire onSuccess", async () => {
    mockSubmitFileDecision.mockResolvedValueOnce(makeExecution());
    const onSuccess = vi.fn();

    const { result } = renderHook(
      () => useWorkflowExecutionActions("wex-001", { onSuccess }),
      { wrapper: createWrapper(makeMockClient()) },
    );

    await act(async () => {
      await result.current.submitFileDecision("aex-child", "fcs-1", 1 as any);
    });

    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("null executionId returns null without calling the SDK", async () => {
    const { result } = renderHook(
      () => useWorkflowExecutionActions(null),
      { wrapper: createWrapper(makeMockClient()) },
    );

    let returned: any;
    await act(async () => {
      returned = await result.current.submitFileDecision("aex-child", "fcs-1", 1 as any);
    });

    expect(returned).toBeNull();
    expect(mockSubmitFileDecision).not.toHaveBeenCalled();
    expect(result.current.fileDecisionSubmittingKeys.size).toBe(0);
  });
});

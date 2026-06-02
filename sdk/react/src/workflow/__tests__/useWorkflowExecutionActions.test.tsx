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

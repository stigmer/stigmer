import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useAgentExecutionActions } from "../useAgentExecutionActions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExecution(id = "aex-001", phase = 2 /* IN_PROGRESS */) {
  return {
    metadata: { id, name: "test-execution", org: "org-1" },
    status: { phase },
  } as any;
}

const mockCancel = vi.fn();
const mockTerminate = vi.fn();
const mockPause = vi.fn();
const mockResume = vi.fn();

function makeMockClient(): Stigmer {
  return {
    agentExecution: {
      cancel: mockCancel,
      terminate: mockTerminate,
      pause: mockPause,
      resume: mockResume,
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
// Lifecycle actions (cancel, terminate, pause, resume)
// ---------------------------------------------------------------------------

describe("useAgentExecutionActions", () => {
  it("cancel returns updated execution on success", async () => {
    const execution = makeExecution("aex-001", 5 /* CANCELLED */);
    mockCancel.mockResolvedValueOnce(execution);

    const { result } = renderHook(
      () => useAgentExecutionActions("aex-001"),
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
    expect(mockCancel.mock.calls[0][0]).toMatchObject({
      id: "aex-001",
      reason: "No longer needed",
    });
  });

  it("terminate returns updated execution on success", async () => {
    const execution = makeExecution("aex-001", 6 /* TERMINATED */);
    mockTerminate.mockResolvedValueOnce(execution);

    const { result } = renderHook(
      () => useAgentExecutionActions("aex-001"),
      { wrapper: createWrapper(makeMockClient()) },
    );

    let returned: any;
    await act(async () => {
      returned = await result.current.terminate("Force stop");
    });

    expect(returned).toBe(execution);
    expect(mockTerminate).toHaveBeenCalledTimes(1);
  });

  it("sets error and returns null on failure", async () => {
    mockCancel.mockRejectedValueOnce(new Error("Temporal not found"));

    const { result } = renderHook(
      () => useAgentExecutionActions("aex-001"),
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
      () => useAgentExecutionActions("aex-001"),
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
    mockCancel
      .mockRejectedValueOnce(new Error("first attempt failed"))
      .mockResolvedValueOnce(makeExecution());

    const { result } = renderHook(
      () => useAgentExecutionActions("aex-001"),
      { wrapper: createWrapper(makeMockClient()) },
    );

    await act(async () => {
      await result.current.cancel();
    });
    expect(result.current.error!.message).toBe("first attempt failed");

    await act(async () => {
      await result.current.cancel();
    });
    expect(result.current.error).toBeNull();
  });

  it("null executionId returns null without calling SDK", async () => {
    const { result } = renderHook(
      () => useAgentExecutionActions(null),
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

  it("resume sends only the id", async () => {
    mockResume.mockResolvedValueOnce(makeExecution("aex-001", 2));

    const { result } = renderHook(
      () => useAgentExecutionActions("aex-001"),
      { wrapper: createWrapper(makeMockClient()) },
    );

    await act(async () => {
      await result.current.resume();
    });

    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(mockResume.mock.calls[0][0]).toMatchObject({ id: "aex-001" });
  });
});

// ---------------------------------------------------------------------------
// onSuccess callback
// ---------------------------------------------------------------------------

describe("onSuccess callback", () => {
  it("fires after a successful lifecycle action", async () => {
    const execution = makeExecution("aex-001", 5);
    mockCancel.mockResolvedValueOnce(execution);
    const onSuccess = vi.fn();

    const { result } = renderHook(
      () => useAgentExecutionActions("aex-001", { onSuccess }),
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
      () => useAgentExecutionActions("aex-001", { onSuccess }),
      { wrapper: createWrapper(makeMockClient()) },
    );

    await act(async () => {
      await result.current.cancel();
    });

    expect(onSuccess).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// stop() — progressive escalation cancel -> terminate
// ---------------------------------------------------------------------------

describe("stop escalation", () => {
  it("first stop cancels, second stop terminates (same execution)", async () => {
    mockCancel.mockResolvedValue(makeExecution("aex-001", 2));
    mockTerminate.mockResolvedValue(makeExecution("aex-001", 6));

    const { result } = renderHook(
      () => useAgentExecutionActions("aex-001"),
      { wrapper: createWrapper(makeMockClient()) },
    );

    await act(async () => {
      await result.current.stop("Stop from chat");
    });
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockTerminate).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.stop("Stop from chat");
    });
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockTerminate).toHaveBeenCalledTimes(1);
  });

  it("escalation resets when the execution id changes", async () => {
    mockCancel.mockResolvedValue(makeExecution());
    mockTerminate.mockResolvedValue(makeExecution());

    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useAgentExecutionActions(id),
      {
        wrapper: createWrapper(makeMockClient()),
        initialProps: { id: "aex-001" as string | null },
      },
    );

    await act(async () => {
      await result.current.stop();
    });
    expect(mockCancel).toHaveBeenCalledTimes(1);

    // A new in-flight execution — stop should cancel gracefully again,
    // not inherit the prior execution's "escalate" state.
    rerender({ id: "aex-002" });
    await act(async () => {
      await result.current.stop();
    });
    expect(mockCancel).toHaveBeenCalledTimes(2);
    expect(mockTerminate).not.toHaveBeenCalled();
  });

  it("stop is a no-op for a null execution id", async () => {
    const { result } = renderHook(
      () => useAgentExecutionActions(null),
      { wrapper: createWrapper(makeMockClient()) },
    );

    let returned: any;
    await act(async () => {
      returned = await result.current.stop();
    });

    expect(returned).toBeNull();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockTerminate).not.toHaveBeenCalled();
  });
});

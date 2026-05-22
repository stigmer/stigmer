import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("../../session/useCreateSession", () => ({
  useCreateSession: vi.fn(),
}));
vi.mock("../../execution/useCreateAgentExecution", () => ({
  useCreateAgentExecution: vi.fn(),
}));
vi.mock("../../execution/useExecutionStream", () => ({
  useExecutionStream: vi.fn(),
}));
vi.mock("../../internal/store", () => ({
  useConversationStoreRef: vi.fn(() => ({ current: null })),
}));

import { useRefineWorkflowFlow } from "../useRefineWorkflowFlow";
import { useCreateSession } from "../../session/useCreateSession";
import { useCreateAgentExecution } from "../../execution/useCreateAgentExecution";
import { useExecutionStream } from "../../execution/useExecutionStream";

const mockCreateSession = vi.fn();
const mockCreateExecution = vi.fn();

function makeExecution(yamlContent?: string) {
  const messages = [];
  if (yamlContent) {
    messages.push({
      type: 2,
      content: `Here is the workflow:\n\n\`\`\`yaml\n${yamlContent}\n\`\`\`\n\nThis workflow does X.`,
    });
  } else {
    messages.push({
      type: 2,
      content: "I analyzed the execution and found a runtime error.",
    });
  }
  return { status: { messages, phase: 4 } } as any;
}

function defaultStreamReturn(overrides: Record<string, unknown> = {}) {
  return {
    execution: null,
    phase: 0,
    isStreaming: false,
    isConnecting: false,
    error: null,
    ...overrides,
  };
}

function defaultOptions() {
  return {
    org: "test-org",
    currentYaml: "apiVersion: test\nname: my-workflow",
    onError: vi.fn(),
  };
}

describe("useRefineWorkflowFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateSession.mockResolvedValue({ sessionId: "sess-123" });
    mockCreateExecution.mockResolvedValue({ executionId: "exec-456" });

    (useCreateSession as ReturnType<typeof vi.fn>).mockReturnValue({
      create: mockCreateSession,
      isCreating: false,
      error: null,
      clearError: vi.fn(),
    });
    (useCreateAgentExecution as ReturnType<typeof vi.fn>).mockReturnValue({
      create: mockCreateExecution,
      isCreating: false,
      error: null,
      clearError: vi.fn(),
    });
    (useExecutionStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn(),
    );
  });

  it("starts in idle phase with null outputs", () => {
    const { result } = renderHook(() => useRefineWorkflowFlow(defaultOptions()));

    expect(result.current.phase).toBe("idle");
    expect(result.current.extractedYaml).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.explanation).toBeNull();
    expect(result.current.completedExecutions).toHaveLength(0);
  });

  it("rejects instruction shorter than 5 characters", async () => {
    const opts = defaultOptions();
    const { result } = renderHook(() => useRefineWorkflowFlow(opts));

    await act(async () => {
      await result.current.sendInstruction("hi");
    });

    expect(result.current.error).toContain("at least 5 characters");
    expect(result.current.phase).toBe("idle");
  });

  it("creates session on first instruction", async () => {
    const opts = defaultOptions();
    const { result } = renderHook(() => useRefineWorkflowFlow(opts));

    await act(async () => {
      await result.current.sendInstruction("Refine the error handling step");
    });

    expect(mockCreateSession).toHaveBeenCalledOnce();
    expect(mockCreateSession).toHaveBeenCalledWith({
      org: "test-org",
      agentRef: { org: "test-org", slug: "workflow-architect" },
    });
  });

  it("reuses session on subsequent instructions", async () => {
    const opts = defaultOptions();
    const { result, rerender } = renderHook(() => useRefineWorkflowFlow(opts));

    await act(async () => {
      await result.current.sendInstruction("Refine the error handling step");
    });

    expect(result.current.phase).toBe("streaming");

    (useExecutionStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({
        phase: 4,
        execution: makeExecution(),
        isStreaming: false,
      }),
    );
    rerender();

    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });

    (useExecutionStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn(),
    );
    mockCreateExecution.mockResolvedValueOnce({ executionId: "exec-789" });

    await act(async () => {
      await result.current.sendInstruction("Add a timeout to the first step");
    });

    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockCreateExecution).toHaveBeenCalledTimes(2);
  });

  it("transitions from starting to streaming", async () => {
    const opts = defaultOptions();
    const { result } = renderHook(() => useRefineWorkflowFlow(opts));

    await act(async () => {
      await result.current.sendInstruction("Refine the error handling step");
    });

    expect(result.current.phase).toBe("streaming");
  });

  it("extracts YAML when stream reaches terminal phase", async () => {
    const opts = defaultOptions();
    const { result, rerender } = renderHook(() => useRefineWorkflowFlow(opts));

    await act(async () => {
      await result.current.sendInstruction("Refine the error handling step");
    });

    expect(result.current.phase).toBe("streaming");

    const yamlContent = "apiVersion: v1\nname: refined-workflow";
    (useExecutionStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({
        phase: 4,
        execution: makeExecution(yamlContent),
        isStreaming: false,
      }),
    );

    rerender();

    await waitFor(() => {
      expect(result.current.phase).toBe("complete");
    });
    expect(result.current.extractedYaml).toBe(yamlContent);
  });

  it("transitions to ready when no YAML at terminal", async () => {
    const opts = defaultOptions();
    const { result, rerender } = renderHook(() => useRefineWorkflowFlow(opts));

    await act(async () => {
      await result.current.sendInstruction("Refine the error handling step");
    });

    (useExecutionStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({
        phase: 4,
        execution: makeExecution(),
        isStreaming: false,
      }),
    );

    rerender();

    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
  });

  it("surfaces stream error", async () => {
    const opts = defaultOptions();
    const { result, rerender } = renderHook(() => useRefineWorkflowFlow(opts));

    await act(async () => {
      await result.current.sendInstruction("Refine the error handling step");
    });

    (useExecutionStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({
        error: new Error("Connection lost"),
      }),
    );

    rerender();

    await waitFor(() => {
      expect(result.current.phase).toBe("error");
    });
    expect(opts.onError).toHaveBeenCalled();
  });

  it("includes YAML context on first send", async () => {
    const opts = defaultOptions();
    opts.currentYaml = "apiVersion: test";
    const { result } = renderHook(() => useRefineWorkflowFlow(opts));

    await act(async () => {
      await result.current.sendInstruction("Add a retry mechanism");
    });

    expect(mockCreateExecution).toHaveBeenCalledOnce();
    const callArgs = mockCreateExecution.mock.calls[0][0];
    expect(callArgs.message).toContain("```yaml");
    expect(callArgs.message).toContain("apiVersion: test");
  });

  it("skips YAML context when unchanged", async () => {
    const opts = defaultOptions();
    opts.currentYaml = "apiVersion: test";
    const { result, rerender } = renderHook(() => useRefineWorkflowFlow(opts));

    await act(async () => {
      await result.current.sendInstruction("Add a retry mechanism");
    });

    (useExecutionStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({
        phase: 4,
        execution: makeExecution(),
        isStreaming: false,
      }),
    );
    rerender();

    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });

    await act(async () => {
      await result.current.sendInstruction("Also add error handling");
    });

    const secondCallArgs = mockCreateExecution.mock.calls[1][0];
    expect(secondCallArgs.message).not.toContain("```yaml");
  });

  it("acceptResult returns YAML and transitions to ready", async () => {
    const opts = defaultOptions();
    const { result, rerender } = renderHook(() => useRefineWorkflowFlow(opts));

    await act(async () => {
      await result.current.sendInstruction("Refine the error handling step");
    });

    const yamlContent = "apiVersion: v1\nname: accepted";
    (useExecutionStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({
        phase: 4,
        execution: makeExecution(yamlContent),
        isStreaming: false,
      }),
    );
    rerender();

    await waitFor(() => {
      expect(result.current.phase).toBe("complete");
    });

    let returnedYaml: string | null = null;
    act(() => {
      returnedYaml = result.current.acceptResult();
    });

    expect(returnedYaml).toBe(yamlContent);
    expect(result.current.phase).toBe("ready");
  });

  it("discardResult transitions to ready without returning YAML", async () => {
    const opts = defaultOptions();
    const { result, rerender } = renderHook(() => useRefineWorkflowFlow(opts));

    await act(async () => {
      await result.current.sendInstruction("Refine the error handling step");
    });

    const yamlContent = "apiVersion: v1\nname: discarded";
    (useExecutionStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({
        phase: 4,
        execution: makeExecution(yamlContent),
        isStreaming: false,
      }),
    );
    rerender();

    await waitFor(() => {
      expect(result.current.phase).toBe("complete");
    });

    act(() => {
      result.current.discardResult();
    });

    expect(result.current.phase).toBe("ready");
    expect(result.current.extractedYaml).toBeNull();
  });

  it("reset clears all state", async () => {
    const opts = defaultOptions();
    const { result, rerender } = renderHook(() => useRefineWorkflowFlow(opts));

    await act(async () => {
      await result.current.sendInstruction("Refine the error handling step");
    });

    const yamlContent = "apiVersion: v1\nname: reset-test";
    (useExecutionStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({
        phase: 4,
        execution: makeExecution(yamlContent),
        isStreaming: false,
      }),
    );
    rerender();

    await waitFor(() => {
      expect(result.current.phase).toBe("complete");
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.phase).toBe("idle");
    expect(result.current.extractedYaml).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.completedExecutions).toHaveLength(0);
  });

  it("no-op when sending during streaming phase", async () => {
    const opts = defaultOptions();
    const { result } = renderHook(() => useRefineWorkflowFlow(opts));

    await act(async () => {
      await result.current.sendInstruction("Refine the error handling step");
    });

    expect(result.current.phase).toBe("streaming");
    const callCountBefore = mockCreateExecution.mock.calls.length;

    await act(async () => {
      await result.current.sendInstruction("Another instruction while streaming");
    });

    expect(mockCreateExecution).toHaveBeenCalledTimes(callCountBefore);
  });
});

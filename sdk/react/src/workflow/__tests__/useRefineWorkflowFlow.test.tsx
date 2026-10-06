import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("../../session/useCreateSession", () => ({
  useCreateSession: vi.fn(),
}));
vi.mock("../../run/useCreateAgentRun", () => ({
  useCreateAgentRun: vi.fn(),
}));
vi.mock("../../run/useRunStream", () => ({
  useRunStream: vi.fn(),
}));
vi.mock("../../internal/store", () => ({
  useConversationStoreRef: vi.fn(() => ({ current: null })),
}));

import { useRefineWorkflowFlow } from "../useRefineWorkflowFlow";
import { useCreateSession } from "../../session/useCreateSession";
import { useCreateAgentRun } from "../../run/useCreateAgentRun";
import { useRunStream } from "../../run/useRunStream";

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
    run: null,
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
    mockCreateExecution.mockResolvedValue({ runId: "exec-456" });

    (useCreateSession as ReturnType<typeof vi.fn>).mockReturnValue({
      create: mockCreateSession,
      isCreating: false,
      error: null,
      clearError: vi.fn(),
    });
    (useCreateAgentRun as ReturnType<typeof vi.fn>).mockReturnValue({
      create: mockCreateExecution,
      isCreating: false,
      error: null,
      clearError: vi.fn(),
    });
    (useRunStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn(),
    );
  });

  it("starts in idle phase with null outputs", () => {
    const { result } = renderHook(() => useRefineWorkflowFlow(defaultOptions()));

    expect(result.current.phase).toBe("idle");
    expect(result.current.extractedYaml).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.explanation).toBeNull();
    expect(result.current.completedRuns).toHaveLength(0);
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

    (useRunStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({
        phase: 4,
        run: makeExecution(),
        isStreaming: false,
      }),
    );
    rerender();

    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });

    (useRunStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn(),
    );
    mockCreateExecution.mockResolvedValueOnce({ runId: "exec-789" });

    await act(async () => {
      await result.current.sendInstruction("Add a timeout to the first step");
    });

    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockCreateExecution).toHaveBeenCalledTimes(2);
  });

  it("continues its session in the organization it was created in, even after org changes (#1580)", async () => {
    const opts = defaultOptions();
    const { result, rerender } = renderHook(
      ({ options }) => useRefineWorkflowFlow(options),
      { initialProps: { options: opts } },
    );

    await act(async () => {
      await result.current.sendInstruction("Refine the error handling step");
    });
    (useRunStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({ phase: 4, run: makeExecution(), isStreaming: false }),
    );
    rerender({ options: { ...opts, org: "other-org" } });
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    (useRunStream as ReturnType<typeof vi.fn>).mockReturnValue(defaultStreamReturn());

    await act(async () => {
      await result.current.sendInstruction("Add a timeout to the first step");
    });

    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockCreateExecution).toHaveBeenLastCalledWith(
      expect.objectContaining({ org: "test-org", sessionId: "sess-123" }),
    );
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
    (useRunStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({
        phase: 4,
        run: makeExecution(yamlContent),
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

    (useRunStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({
        phase: 4,
        run: makeExecution(),
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

    (useRunStream as ReturnType<typeof vi.fn>).mockReturnValue(
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

    (useRunStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({
        phase: 4,
        run: makeExecution(),
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
    (useRunStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({
        phase: 4,
        run: makeExecution(yamlContent),
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
    (useRunStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({
        phase: 4,
        run: makeExecution(yamlContent),
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
    (useRunStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({
        phase: 4,
        run: makeExecution(yamlContent),
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
    expect(result.current.completedRuns).toHaveLength(0);
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

  it("passes structuredOutputSchema when creating execution", async () => {
    const opts = defaultOptions();
    const { result } = renderHook(() => useRefineWorkflowFlow(opts));

    await act(async () => {
      await result.current.sendInstruction("Refine the error handling step");
    });

    expect(mockCreateExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        structuredOutputSchema: expect.objectContaining({
          type: "object",
          required: ["action", "explanation"],
        }),
      }),
    );
  });

  it("reads YAML from structuredOutput on terminal phase", async () => {
    const opts = defaultOptions();
    const { result, rerender } = renderHook(() => useRefineWorkflowFlow(opts));

    await act(async () => {
      await result.current.sendInstruction("Refine the error handling step");
    });

    const yamlContent = "apiVersion: v1\nname: from-structured";
    (useRunStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({
        phase: 4,
        run: {
          status: {
            messages: [{ type: 2, content: "Done" }],
            phase: 4,
            structuredOutput: {
              action: "generated_yaml",
              yaml: yamlContent,
              explanation: "Added retry to step 1.",
            },
          },
        },
        isStreaming: false,
      }),
    );
    rerender();

    await waitFor(() => {
      expect(result.current.phase).toBe("complete");
    });
    expect(result.current.extractedYaml).toBe(yamlContent);
  });

  it("structured output clarification action → ready", async () => {
    const opts = defaultOptions();
    const { result, rerender } = renderHook(() => useRefineWorkflowFlow(opts));

    await act(async () => {
      await result.current.sendInstruction("Refine the error handling step");
    });

    (useRunStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({
        phase: 4,
        run: {
          status: {
            messages: [{ type: 2, content: "Need more info" }],
            phase: 4,
            structuredOutput: {
              action: "clarification",
              explanation: "Which step should have retry?",
            },
          },
        },
        isStreaming: false,
      }),
    );
    rerender();

    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
  });
});

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

import { useDiagnoseExecutionFlow } from "../useDiagnoseExecutionFlow";
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
    executionId: "wex-failed-123",
    org: "test-org",
    onError: vi.fn(),
  };
}

describe("useDiagnoseExecutionFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateSession.mockResolvedValue({ sessionId: "sess-diag-1" });
    mockCreateExecution.mockResolvedValue({ executionId: "exec-diag-1" });

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

  it("auto-starts diagnosis on mount by default", async () => {
    const opts = defaultOptions();

    await act(async () => {
      renderHook(() => useDiagnoseExecutionFlow(opts));
    });

    expect(mockCreateSession).toHaveBeenCalledOnce();
    expect(mockCreateExecution).toHaveBeenCalledOnce();
  });

  it("stays idle when autoStart is false", () => {
    const opts = { ...defaultOptions(), autoStart: false };

    const { result } = renderHook(() => useDiagnoseExecutionFlow(opts));

    expect(result.current.phase).toBe("idle");
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockCreateExecution).not.toHaveBeenCalled();
  });

  it("builds diagnosis message containing executionId", async () => {
    const opts = defaultOptions();

    await act(async () => {
      renderHook(() => useDiagnoseExecutionFlow(opts));
    });

    expect(mockCreateExecution).toHaveBeenCalledOnce();
    const callArgs = mockCreateExecution.mock.calls[0][0];
    expect(callArgs.message).toContain("wex-failed-123");
  });

  it("transitions to complete when YAML fix found", async () => {
    const opts = { ...defaultOptions(), autoStart: false };
    const { result, rerender } = renderHook(() =>
      useDiagnoseExecutionFlow(opts),
    );

    await act(async () => {
      await result.current.diagnose();
    });

    expect(result.current.phase).toBe("streaming");

    const yamlContent = "apiVersion: v1\nname: fixed-workflow";
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

  it("transitions to ready when no YAML fix (runtime error)", async () => {
    const opts = { ...defaultOptions(), autoStart: false };
    const { result, rerender } = renderHook(() =>
      useDiagnoseExecutionFlow(opts),
    );

    await act(async () => {
      await result.current.diagnose();
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

  it("adds completed execution to history", async () => {
    const opts = { ...defaultOptions(), autoStart: false };
    const { result, rerender } = renderHook(() =>
      useDiagnoseExecutionFlow(opts),
    );

    await act(async () => {
      await result.current.diagnose();
    });

    const execution = makeExecution();
    (useExecutionStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({
        phase: 4,
        execution,
        isStreaming: false,
      }),
    );

    rerender();

    await waitFor(() => {
      expect(result.current.completedExecutions).toHaveLength(1);
    });
  });

  it("sendFollowUp rejects text shorter than 5 chars", async () => {
    const opts = { ...defaultOptions(), autoStart: false };
    const { result, rerender } = renderHook(() =>
      useDiagnoseExecutionFlow(opts),
    );

    await act(async () => {
      await result.current.diagnose();
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
      await result.current.sendFollowUp("hi");
    });

    expect(result.current.error).toContain("at least 5 characters");
  });

  it("sendFollowUp reuses existing session", async () => {
    const opts = { ...defaultOptions(), autoStart: false };
    const { result, rerender } = renderHook(() =>
      useDiagnoseExecutionFlow(opts),
    );

    await act(async () => {
      await result.current.diagnose();
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

    mockCreateExecution.mockResolvedValueOnce({ executionId: "exec-diag-2" });

    await act(async () => {
      await result.current.sendFollowUp("Can you explain the root cause in more detail?");
    });

    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockCreateExecution).toHaveBeenCalledTimes(2);
  });

  it("sendFollowUp allowed from ready phase", async () => {
    const opts = { ...defaultOptions(), autoStart: false };
    const { result, rerender } = renderHook(() =>
      useDiagnoseExecutionFlow(opts),
    );

    await act(async () => {
      await result.current.diagnose();
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

    (useExecutionStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn(),
    );
    mockCreateExecution.mockResolvedValueOnce({ executionId: "exec-diag-2" });

    await act(async () => {
      await result.current.sendFollowUp("What was the exact error message?");
    });

    expect(result.current.phase).toBe("streaming");
  });

  it("sendFollowUp blocked during streaming", async () => {
    const opts = { ...defaultOptions(), autoStart: false };
    const { result } = renderHook(() => useDiagnoseExecutionFlow(opts));

    await act(async () => {
      await result.current.diagnose();
    });

    expect(result.current.phase).toBe("streaming");
    const callCount = mockCreateExecution.mock.calls.length;

    await act(async () => {
      await result.current.sendFollowUp("Tell me more about the error");
    });

    expect(mockCreateExecution).toHaveBeenCalledTimes(callCount);
  });

  it("acceptFix returns YAML and transitions to ready", async () => {
    const opts = { ...defaultOptions(), autoStart: false };
    const { result, rerender } = renderHook(() =>
      useDiagnoseExecutionFlow(opts),
    );

    await act(async () => {
      await result.current.diagnose();
    });

    const yamlContent = "apiVersion: v1\nname: fixed-workflow";
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
      returnedYaml = result.current.acceptFix();
    });

    expect(returnedYaml).toBe(yamlContent);
    expect(result.current.phase).toBe("ready");
  });

  it("discardFix transitions to ready", async () => {
    const opts = { ...defaultOptions(), autoStart: false };
    const { result, rerender } = renderHook(() =>
      useDiagnoseExecutionFlow(opts),
    );

    await act(async () => {
      await result.current.diagnose();
    });

    const yamlContent = "apiVersion: v1\nname: discarded-fix";
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
      result.current.discardFix();
    });

    expect(result.current.phase).toBe("ready");
    expect(result.current.extractedYaml).toBeNull();
  });

  it("reset clears all state including autoStart guard", async () => {
    const opts = { ...defaultOptions(), autoStart: false };
    const { result, rerender } = renderHook(() =>
      useDiagnoseExecutionFlow(opts),
    );

    await act(async () => {
      await result.current.diagnose();
    });

    (useExecutionStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({
        phase: 4,
        execution: makeExecution("apiVersion: v1\nname: test"),
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
});

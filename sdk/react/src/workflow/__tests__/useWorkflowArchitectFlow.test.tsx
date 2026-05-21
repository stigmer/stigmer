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
vi.mock("../../hooks", () => ({
  useStigmer: vi.fn(),
}));
vi.mock("../serialize-workflow-yaml", () => ({
  parseWorkflowYaml: vi.fn(),
}));

import { useWorkflowArchitectFlow } from "../useWorkflowArchitectFlow";
import { useCreateSession } from "../../session/useCreateSession";
import { useCreateAgentExecution } from "../../execution/useCreateAgentExecution";
import { useExecutionStream } from "../../execution/useExecutionStream";
import { useStigmer } from "../../hooks";
import { parseWorkflowYaml } from "../serialize-workflow-yaml";

const mockCreateSession = vi.fn();
const mockCreateExecution = vi.fn();
const mockApply = vi.fn();

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
    onSuccess: vi.fn(),
    onError: vi.fn(),
  };
}

describe("useWorkflowArchitectFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateSession.mockResolvedValue({ sessionId: "sess-123" });
    mockCreateExecution.mockResolvedValue({ executionId: "exec-456" });
    mockApply.mockResolvedValue({
      metadata: { org: "test-org", slug: "generated-workflow" },
    });

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
    (useStigmer as ReturnType<typeof vi.fn>).mockReturnValue({
      workflow: { apply: mockApply },
    });
    (parseWorkflowYaml as ReturnType<typeof vi.fn>).mockReturnValue({
      name: "generated-workflow",
      org: "test-org",
      document: {},
      tasks: [],
    });
  });

  it("starts in idle phase with empty prompt", () => {
    const { result } = renderHook(() => useWorkflowArchitectFlow(defaultOptions()));

    expect(result.current.phase).toBe("idle");
    expect(result.current.prompt).toBe("");
    expect(result.current.error).toBeNull();
    expect(result.current.extractedYaml).toBeNull();
  });

  it("setPrompt updates prompt value", () => {
    const { result } = renderHook(() => useWorkflowArchitectFlow(defaultOptions()));

    act(() => {
      result.current.setPrompt("test prompt value");
    });

    expect(result.current.prompt).toBe("test prompt value");
  });

  it("rejects prompt shorter than 10 characters", async () => {
    const { result } = renderHook(() => useWorkflowArchitectFlow(defaultOptions()));

    act(() => {
      result.current.setPrompt("short");
    });

    await act(async () => {
      await result.current.generate();
    });

    expect(result.current.error).toContain("at least 10 characters");
    expect(result.current.phase).toBe("idle");
  });

  it("generate creates session and execution", async () => {
    const { result } = renderHook(() => useWorkflowArchitectFlow(defaultOptions()));

    act(() => {
      result.current.setPrompt("Create a workflow that processes user onboarding");
    });

    await act(async () => {
      await result.current.generate();
    });

    expect(mockCreateSession).toHaveBeenCalledOnce();
    expect(mockCreateExecution).toHaveBeenCalledOnce();
    expect(mockCreateExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        org: "test-org",
        sessionId: "sess-123",
        message: "Create a workflow that processes user onboarding",
      }),
    );
  });

  it("transitions from starting to streaming", async () => {
    const { result } = renderHook(() => useWorkflowArchitectFlow(defaultOptions()));

    act(() => {
      result.current.setPrompt("Create a workflow that processes user onboarding");
    });

    await act(async () => {
      await result.current.generate();
    });

    expect(result.current.phase).toBe("streaming");
  });

  it("extracts YAML on terminal phase → complete", async () => {
    const { result, rerender } = renderHook(() =>
      useWorkflowArchitectFlow(defaultOptions()),
    );

    act(() => {
      result.current.setPrompt("Create a workflow that processes user onboarding");
    });

    await act(async () => {
      await result.current.generate();
    });

    expect(result.current.phase).toBe("streaming");

    const yamlContent = "apiVersion: v1\nname: generated-workflow";
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

  it("no YAML at terminal → extraction-failed with error", async () => {
    const { result, rerender } = renderHook(() =>
      useWorkflowArchitectFlow(defaultOptions()),
    );

    act(() => {
      result.current.setPrompt("Create a workflow that processes user onboarding");
    });

    await act(async () => {
      await result.current.generate();
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
      expect(result.current.phase).toBe("extraction-failed");
    });
    expect(result.current.error).toContain("did not produce a YAML");
  });

  it("surfaces stream error", async () => {
    const opts = defaultOptions();
    const { result, rerender } = renderHook(() =>
      useWorkflowArchitectFlow(opts),
    );

    act(() => {
      result.current.setPrompt("Create a workflow that processes user onboarding");
    });

    await act(async () => {
      await result.current.generate();
    });

    (useExecutionStream as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStreamReturn({
        error: new Error("WebSocket closed"),
      }),
    );

    rerender();

    await waitFor(() => {
      expect(result.current.phase).toBe("error");
    });
    expect(opts.onError).toHaveBeenCalled();
  });

  it("surfaces RPC failure", async () => {
    const opts = defaultOptions();
    mockCreateSession.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useWorkflowArchitectFlow(opts));

    act(() => {
      result.current.setPrompt("Create a workflow that processes user onboarding");
    });

    await act(async () => {
      await result.current.generate();
    });

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBeTruthy();
    expect(opts.onError).toHaveBeenCalled();
  });

  it("createWorkflow calls apply and onSuccess", async () => {
    const opts = defaultOptions();
    const { result, rerender } = renderHook(() =>
      useWorkflowArchitectFlow(opts),
    );

    act(() => {
      result.current.setPrompt("Create a workflow that processes user onboarding");
    });

    await act(async () => {
      await result.current.generate();
    });

    const yamlContent = "apiVersion: v1\nname: generated-workflow";
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

    await act(async () => {
      await result.current.createWorkflow();
    });

    expect(parseWorkflowYaml).toHaveBeenCalledWith(yamlContent, "test-org");
    expect(mockApply).toHaveBeenCalledOnce();
    expect(opts.onSuccess).toHaveBeenCalledWith("test-org", "generated-workflow");
  });

  it("createWorkflow handles apply error", async () => {
    const opts = defaultOptions();
    mockApply.mockRejectedValueOnce(new Error("Validation failed"));

    const { result, rerender } = renderHook(() =>
      useWorkflowArchitectFlow(opts),
    );

    act(() => {
      result.current.setPrompt("Create a workflow that processes user onboarding");
    });

    await act(async () => {
      await result.current.generate();
    });

    const yamlContent = "apiVersion: v1\nname: generated-workflow";
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

    await act(async () => {
      await result.current.createWorkflow();
    });

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBeTruthy();
  });

  it("reset clears all state", async () => {
    const { result, rerender } = renderHook(() =>
      useWorkflowArchitectFlow(defaultOptions()),
    );

    act(() => {
      result.current.setPrompt("Create a workflow that processes user onboarding");
    });

    await act(async () => {
      await result.current.generate();
    });

    const yamlContent = "apiVersion: v1\nname: generated-workflow";
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
    expect(result.current.prompt).toBe("");
    expect(result.current.extractedYaml).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

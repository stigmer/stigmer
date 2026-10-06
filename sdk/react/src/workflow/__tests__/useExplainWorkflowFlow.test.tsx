/**
 * Pins useExplainWorkflowFlow's organization (stigmer/stigmer#1580): the
 * session and its one turn are created in the organization read when the
 * explanation starts, so an `org` change while the session create is in
 * flight never files the turn under another organization than its
 * session's. Also pins the ending: when the run's stream reaches a terminal
 * phase, the explanation is read from the run's structured output and the
 * flow completes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

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

import { useExplainWorkflowFlow } from "../useExplainWorkflowFlow";
import { useCreateSession } from "../../session/useCreateSession";
import { useCreateAgentRun } from "../../run/useCreateAgentRun";
import { useRunStream } from "../../run/useRunStream";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";

const mockCreateSession = vi.fn();
const mockCreateExecution = vi.fn();

describe("useExplainWorkflowFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateExecution.mockResolvedValue({ runId: "run-1" });
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
    (useRunStream as ReturnType<typeof vi.fn>).mockReturnValue({
      run: null,
      phase: 0,
      isStreaming: false,
      isConnecting: false,
      error: null,
    });
  });

  it("files its turn in the organization the session was created in, even if org changes meanwhile", async () => {
    let releaseSession: (value: { sessionId: string }) => void = () => {};
    mockCreateSession.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseSession = resolve;
      }),
    );
    const opts = {
      org: "test-org",
      currentYaml: "name: my-workflow",
      onError: vi.fn(),
    };
    const { result, rerender } = renderHook(
      ({ options }) => useExplainWorkflowFlow(options),
      { initialProps: { options: opts } },
    );

    let explaining: Promise<void> = Promise.resolve();
    act(() => {
      explaining = result.current.explain();
    });
    rerender({ options: { ...opts, org: "other-org" } });
    await act(async () => {
      releaseSession({ sessionId: "sess-1" });
      await explaining;
    });

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ org: "test-org" }),
    );
    expect(mockCreateExecution).toHaveBeenCalledWith(
      expect.objectContaining({ org: "test-org", sessionId: "sess-1" }),
    );
  });

  it("streams the run it started and completes with the explanation from its structured output", async () => {
    mockCreateSession.mockResolvedValue({ sessionId: "sess-1" });
    const { result, rerender } = renderHook(
      ({ options }) => useExplainWorkflowFlow(options),
      {
        initialProps: {
          options: { org: "test-org", currentYaml: "name: my-workflow" },
        },
      },
    );

    await act(async () => {
      await result.current.explain();
    });
    expect(result.current.phase).toBe("streaming");
    expect(vi.mocked(useRunStream)).toHaveBeenLastCalledWith("run-1", expect.anything());

    const run = {
      status: { structuredOutput: { explanation: "It triages the inbox nightly." } },
    };
    vi.mocked(useRunStream).mockReturnValue({
      run,
      phase: RunPhase.RUN_COMPLETED,
      isStreaming: false,
      isConnecting: false,
      error: null,
    } as unknown as ReturnType<typeof useRunStream>);
    rerender({ options: { org: "test-org", currentYaml: "name: my-workflow" } });

    expect(result.current.phase).toBe("complete");
    expect(result.current.explanation).toBe("It triages the inbox nightly.");
  });
});

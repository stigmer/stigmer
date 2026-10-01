/**
 * Pins useExplainWorkflowFlow's organization (stigmer/stigmer#1580): the
 * session and its one turn are created in the organization read when the
 * explanation starts, so an `org` change while the session create is in
 * flight never files the turn under another organization than its
 * session's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

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

import { useExplainWorkflowFlow } from "../useExplainWorkflowFlow";
import { useCreateSession } from "../../session/useCreateSession";
import { useCreateAgentExecution } from "../../execution/useCreateAgentExecution";
import { useExecutionStream } from "../../execution/useExecutionStream";

const mockCreateSession = vi.fn();
const mockCreateExecution = vi.fn();

describe("useExplainWorkflowFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateExecution.mockResolvedValue({ executionId: "exec-1" });
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
    (useExecutionStream as ReturnType<typeof vi.fn>).mockReturnValue({
      execution: null,
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
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SessionSchema, type Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { ExecutionTargetContext } from "../../execution-target-context";
import { RunnerAdapterContext } from "../../runner-adapter";
import type { RunnerAdapter } from "../../runner-adapter";
import { useSessionConversation } from "../useSessionConversation";

function makeSession(id: string): Session {
  const session = create(SessionSchema);
  const metadata = create(ApiResourceMetadataSchema);
  metadata.id = id;
  session.metadata = metadata;
  return session;
}

function makeExecution(id: string, phase: ExecutionPhase): AgentExecution {
  const exec = create(AgentExecutionSchema);
  const metadata = create(ApiResourceMetadataSchema);
  metadata.id = id;
  exec.metadata = metadata;
  const status = create(AgentExecutionStatusSchema);
  status.phase = phase;
  exec.status = status;
  return exec;
}

/**
 * Creates a controllable async generator for streaming.
 */
function createControllableStream<T>() {
  let resolve: ((v: IteratorResult<T>) => void) | null = null;
  let reject: ((err: unknown) => void) | null = null;

  const generator: AsyncGenerator<T> = {
    next() {
      return new Promise<IteratorResult<T>>((res, rej) => {
        resolve = res;
        reject = rej;
      });
    },
    return(value?: unknown) {
      return Promise.resolve({ done: true as const, value: value as T });
    },
    throw(err?: unknown) {
      return Promise.reject(err);
    },
    [Symbol.asyncIterator]() {
      return generator;
    },
  };

  return {
    generator,
    push(value: T) {
      resolve?.({ done: false, value });
    },
    finish() {
      resolve?.({ done: true, value: undefined as unknown as T });
    },
    fail(err: Error) {
      reject?.(err);
    },
  };
}

interface MockMethods {
  sessionGet: ReturnType<typeof vi.fn>;
  listBySession: ReturnType<typeof vi.fn>;
  executionCreate: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  submitApproval: ReturnType<typeof vi.fn>;
  cancel?: ReturnType<typeof vi.fn>;
  terminate?: ReturnType<typeof vi.fn>;
}

function createMockStigmer(methods: MockMethods): Stigmer {
  return {
    session: {
      get: methods.sessionGet,
    },
    agentExecution: {
      listBySession: methods.listBySession,
      create: methods.executionCreate,
      subscribe: methods.subscribe,
      submitApproval: methods.submitApproval,
      cancel: methods.cancel,
      terminate: methods.terminate,
    },
  } as unknown as Stigmer;
}

function createWrapper(client: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
    );
  };
}

describe("useSessionConversation", () => {
  let methods: MockMethods;
  let mockStigmer: Stigmer;
  let stream: ReturnType<typeof createControllableStream<AgentExecution>>;

  beforeEach(() => {
    stream = createControllableStream<AgentExecution>();
    methods = {
      sessionGet: vi.fn().mockResolvedValue(makeSession("session-1")),
      listBySession: vi.fn().mockResolvedValue({ entries: [] }),
      executionCreate: vi.fn(),
      subscribe: vi.fn().mockReturnValue(stream.generator),
      submitApproval: vi.fn().mockResolvedValue({}),
      cancel: vi.fn().mockResolvedValue(makeExecution("e1", ExecutionPhase.EXECUTION_CANCELLED)),
      terminate: vi.fn().mockResolvedValue(makeExecution("e1", ExecutionPhase.EXECUTION_TERMINATED)),
    };
    mockStigmer = createMockStigmer(methods);
  });

  it("returns idle state when sessionId is null", () => {
    const { result } = renderHook(
      () => useSessionConversation(null, "org"),
      { wrapper: createWrapper(mockStigmer) },
    );

    expect(result.current.session).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.canSendFollowUp).toBe(true);
    expect(methods.sessionGet).not.toHaveBeenCalled();
    expect(methods.listBySession).not.toHaveBeenCalled();
  });

  it("isLoading is true while session and executions are loading", () => {
    methods.sessionGet.mockReturnValue(new Promise(() => {}));
    methods.listBySession.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(
      () => useSessionConversation("session-1", "org"),
      { wrapper: createWrapper(mockStigmer) },
    );

    expect(result.current.isLoading).toBe(true);
  });

  it("loads session and executions on mount", async () => {
    const session = makeSession("session-1");
    methods.sessionGet.mockResolvedValue(session);
    methods.listBySession.mockResolvedValue({ entries: [] });

    const { result } = renderHook(
      () => useSessionConversation("session-1", "org"),
      { wrapper: createWrapper(mockStigmer) },
    );

    await waitFor(() => {
      expect(result.current.session).toBe(session);
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("surfaces session fetch errors in loadError", async () => {
    methods.sessionGet.mockRejectedValue(new Error("session not found"));

    const { result } = renderHook(
      () => useSessionConversation("session-1", "org"),
      { wrapper: createWrapper(mockStigmer) },
    );

    await waitFor(() => {
      expect(result.current.loadError?.message).toBe("session not found");
    });
  });

  it("completedExecutions excludes the active non-terminal execution", async () => {
    const completed = makeExecution("e1", ExecutionPhase.EXECUTION_COMPLETED);
    const active = makeExecution("e2", ExecutionPhase.EXECUTION_IN_PROGRESS);
    methods.listBySession.mockResolvedValue({
      entries: [completed, active],
    });

    const { result } = renderHook(
      () => useSessionConversation("session-1", "org"),
      { wrapper: createWrapper(mockStigmer) },
    );

    await waitFor(() => {
      expect(result.current.completedExecutions).toHaveLength(1);
      expect(result.current.completedExecutions[0]).toBe(completed);
    });
  });

  it("canSendFollowUp is true when no active execution", async () => {
    const completed = makeExecution("e1", ExecutionPhase.EXECUTION_COMPLETED);
    methods.listBySession.mockResolvedValue({ entries: [completed] });

    const { result } = renderHook(
      () => useSessionConversation("session-1", "org"),
      { wrapper: createWrapper(mockStigmer) },
    );

    await waitFor(() => {
      expect(result.current.canSendFollowUp).toBe(true);
    });
  });

  it("canSendFollowUp is false while an execution is active", async () => {
    const active = makeExecution("e1", ExecutionPhase.EXECUTION_IN_PROGRESS);
    methods.listBySession.mockResolvedValue({ entries: [active] });

    const { result } = renderHook(
      () => useSessionConversation("session-1", "org"),
      { wrapper: createWrapper(mockStigmer) },
    );

    await waitFor(() => {
      expect(result.current.canSendFollowUp).toBe(false);
    });
  });

  it("sendFollowUp sets pendingUserMessage optimistically", async () => {
    methods.listBySession.mockResolvedValue({ entries: [] });
    const newExec = makeExecution("new-exec", ExecutionPhase.EXECUTION_PENDING);
    newExec.metadata!.id = "new-exec";
    methods.executionCreate.mockResolvedValue(newExec);

    const { result } = renderHook(
      () => useSessionConversation("session-1", "org"),
      { wrapper: createWrapper(mockStigmer) },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.sendFollowUp("Hello agent");
    });

    expect(result.current.pendingUserMessage).toBe("Hello agent");
  });

  it("sendFollowUp creates execution via the SDK", async () => {
    methods.listBySession.mockResolvedValue({ entries: [] });
    const newExec = makeExecution("new-exec", ExecutionPhase.EXECUTION_PENDING);
    newExec.metadata!.id = "new-exec";
    methods.executionCreate.mockResolvedValue(newExec);

    const { result } = renderHook(
      () => useSessionConversation("session-1", "org"),
      { wrapper: createWrapper(mockStigmer) },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.sendFollowUp("Deploy it");
    });

    expect(methods.executionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        org: "org",
        sessionId: "session-1",
        message: "Deploy it",
      }),
    );
  });

  it("pendingUserMessage clears when stream delivers first snapshot", async () => {
    methods.listBySession.mockResolvedValue({ entries: [] });

    const newExec = makeExecution("new-exec", ExecutionPhase.EXECUTION_PENDING);
    newExec.metadata!.id = "new-exec";
    methods.executionCreate.mockResolvedValue(newExec);

    const newStream = createControllableStream<AgentExecution>();
    methods.subscribe.mockReturnValue(newStream.generator);

    const { result } = renderHook(
      () => useSessionConversation("session-1", "org"),
      { wrapper: createWrapper(mockStigmer) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.sendFollowUp("Hello");
    });

    expect(result.current.pendingUserMessage).toBe("Hello");

    act(() => {
      newStream.push(
        makeExecution("new-exec", ExecutionPhase.EXECUTION_IN_PROGRESS),
      );
    });

    await waitFor(() => {
      expect(result.current.pendingUserMessage).toBeNull();
    });
  });

  it("sets NO optimistic pendingUserMessage for a buildFromPlan send (the thread hides the turn)", async () => {
    methods.listBySession.mockResolvedValue({ entries: [] });
    const newExec = makeExecution("new-exec", ExecutionPhase.EXECUTION_PENDING);
    newExec.metadata!.id = "new-exec";
    methods.executionCreate.mockResolvedValue(newExec);

    const { result } = renderHook(
      () => useSessionConversation("session-1", "org"),
      { wrapper: createWrapper(mockStigmer) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.sendFollowUp("Build from plan", {
        buildFromPlan: true,
      });
    });

    expect(result.current.pendingUserMessage).toBeNull();
    expect(methods.executionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Build from plan" }),
    );
  });

  it("sets pendingUserMessage when a buildFromPlan send FAILS (failure must be visible)", async () => {
    methods.listBySession.mockResolvedValue({ entries: [] });
    methods.executionCreate.mockRejectedValue(new Error("create boom"));

    const { result } = renderHook(
      () => useSessionConversation("session-1", "org"),
      { wrapper: createWrapper(mockStigmer) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.sendFollowUp("Build from plan", {
        buildFromPlan: true,
      });
    });

    expect(result.current.sendError?.message).toBe("create boom");
    expect(result.current.pendingUserMessage).toBe("Build from plan");
  });

  it("preserves the message and surfaces sendError when the send fails", async () => {
    methods.listBySession.mockResolvedValue({ entries: [] });
    methods.executionCreate.mockRejectedValue(new Error("create boom"));

    const { result } = renderHook(
      () => useSessionConversation("session-1", "org"),
      { wrapper: createWrapper(mockStigmer) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.sendFollowUp("keep me");
    });

    // The failure is surfaced and the user's text is NOT lost.
    expect(result.current.sendError?.message).toBe("create boom");
    expect(result.current.pendingUserMessage).toBe("keep me");
  });

  it("retryLastSend resubmits the same message after a failure", async () => {
    methods.listBySession.mockResolvedValue({ entries: [] });
    methods.executionCreate.mockRejectedValueOnce(new Error("boom"));
    const retried = makeExecution("e-retry", ExecutionPhase.EXECUTION_PENDING);
    retried.metadata!.id = "e-retry";
    methods.executionCreate.mockResolvedValue(retried);

    const { result } = renderHook(
      () => useSessionConversation("session-1", "org"),
      { wrapper: createWrapper(mockStigmer) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.sendFollowUp("retry me");
    });
    expect(result.current.sendError).not.toBeNull();

    await act(async () => {
      result.current.retryLastSend();
    });

    await waitFor(() =>
      expect(methods.executionCreate).toHaveBeenCalledTimes(2),
    );
    expect(methods.executionCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "retry me" }),
    );
    // The retry cleared the prior failure for the new attempt.
    expect(result.current.sendError).toBeNull();
  });

  it("full follow-up lifecycle: active execution completes → canSendFollowUp → sendFollowUp succeeds", async () => {
    // Start with one IN_PROGRESS execution (simulates a Cursor execution running)
    const activeExec = makeExecution("exec-1", ExecutionPhase.EXECUTION_IN_PROGRESS);
    methods.listBySession.mockResolvedValue({ entries: [activeExec] });

    const execStream = createControllableStream<AgentExecution>();
    methods.subscribe.mockReturnValue(execStream.generator);

    const { result } = renderHook(
      () => useSessionConversation("session-1", "org"),
      { wrapper: createWrapper(mockStigmer) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Initially canSendFollowUp should be false (execution is active)
    expect(result.current.canSendFollowUp).toBe(false);

    // Stream delivers EXECUTION_COMPLETED — simulating Cursor run finishing
    const completedExec = makeExecution("exec-1", ExecutionPhase.EXECUTION_COMPLETED);
    act(() => {
      execStream.push(completedExec);
    });

    // After stream completes, the hook should refetch executions.
    // Mock the refetch to return the completed execution.
    methods.listBySession.mockResolvedValue({ entries: [completedExec] });

    // Wait for canSendFollowUp to become true
    await waitFor(() => {
      expect(result.current.canSendFollowUp).toBe(true);
    });

    // Now send a follow-up message
    const followUpExec = makeExecution("exec-2", ExecutionPhase.EXECUTION_PENDING);
    followUpExec.metadata!.id = "exec-2";
    methods.executionCreate.mockResolvedValue(followUpExec);

    await act(async () => {
      await result.current.sendFollowUp("Follow-up message", { modelName: "default" });
    });

    // Verify the create call was made with the correct session and message
    expect(methods.executionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        org: "org",
        sessionId: "session-1",
        message: "Follow-up message",
        executionConfig: expect.objectContaining({ modelName: "default" }),
      }),
    );
  });

  it("isStoppable is false when no execution is active", async () => {
    const completed = makeExecution("e1", ExecutionPhase.EXECUTION_COMPLETED);
    methods.listBySession.mockResolvedValue({ entries: [completed] });

    const { result } = renderHook(
      () => useSessionConversation("session-1", "org"),
      { wrapper: createWrapper(mockStigmer) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isStoppable).toBe(false);
  });

  it("isStoppable becomes true once the active execution streams IN_PROGRESS", async () => {
    const active = makeExecution("e1", ExecutionPhase.EXECUTION_IN_PROGRESS);
    methods.listBySession.mockResolvedValue({ entries: [active] });

    const execStream = createControllableStream<AgentExecution>();
    methods.subscribe.mockReturnValue(execStream.generator);

    const { result } = renderHook(
      () => useSessionConversation("session-1", "org"),
      { wrapper: createWrapper(mockStigmer) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      execStream.push(makeExecution("e1", ExecutionPhase.EXECUTION_IN_PROGRESS));
    });

    await waitFor(() => expect(result.current.isStoppable).toBe(true));
  });

  it("stop() cancels the active execution, then escalates to terminate on repeat", async () => {
    const active = makeExecution("e1", ExecutionPhase.EXECUTION_IN_PROGRESS);
    methods.listBySession.mockResolvedValue({ entries: [active] });

    const execStream = createControllableStream<AgentExecution>();
    methods.subscribe.mockReturnValue(execStream.generator);

    const { result } = renderHook(
      () => useSessionConversation("session-1", "org"),
      { wrapper: createWrapper(mockStigmer) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      execStream.push(makeExecution("e1", ExecutionPhase.EXECUTION_IN_PROGRESS));
    });
    await waitFor(() => expect(result.current.isStoppable).toBe(true));

    await act(async () => {
      await result.current.stop("Stop from chat");
    });
    expect(methods.cancel).toHaveBeenCalledTimes(1);
    expect(methods.cancel!.mock.calls[0][0]).toMatchObject({ id: "e1" });
    expect(methods.terminate).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.stop("Stop from chat");
    });
    expect(methods.cancel).toHaveBeenCalledTimes(1);
    expect(methods.terminate).toHaveBeenCalledTimes(1);
  });

  it("stop() is a no-op when nothing is stoppable", async () => {
    const completed = makeExecution("e1", ExecutionPhase.EXECUTION_COMPLETED);
    methods.listBySession.mockResolvedValue({ entries: [completed] });

    const { result } = renderHook(
      () => useSessionConversation("session-1", "org"),
      { wrapper: createWrapper(mockStigmer) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.stop();
    });

    expect(methods.cancel).not.toHaveBeenCalled();
    expect(methods.terminate).not.toHaveBeenCalled();
  });
});

describe("useSessionConversation — local runner worker lifecycle", () => {
  let methods: MockMethods;
  let mockStigmer: Stigmer;
  let stream: ReturnType<typeof createControllableStream<AgentExecution>>;

  function createMockAdapter(): RunnerAdapter & {
    onSessionOpened: ReturnType<typeof vi.fn>;
    onSessionClosed: ReturnType<typeof vi.fn>;
    onWorkflowExecutionCreated: ReturnType<typeof vi.fn>;
    onWorkflowExecutionTerminated: ReturnType<typeof vi.fn>;
  } {
    return {
      onSessionOpened: vi.fn().mockResolvedValue(undefined),
      onSessionClosed: vi.fn().mockResolvedValue(undefined),
      onWorkflowExecutionCreated: vi.fn().mockResolvedValue(undefined),
      onWorkflowExecutionTerminated: vi.fn().mockResolvedValue(undefined),
    };
  }

  function localWrapper(client: Stigmer, adapter: RunnerAdapter) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <ExecutionTargetContext.Provider value="local">
          <RunnerAdapterContext.Provider value={adapter}>
            <StigmerContext.Provider value={client}>
              {children}
            </StigmerContext.Provider>
          </RunnerAdapterContext.Provider>
        </ExecutionTargetContext.Provider>
      );
    };
  }

  beforeEach(() => {
    stream = createControllableStream<AgentExecution>();
    methods = {
      sessionGet: vi.fn().mockResolvedValue(makeSession("session-1")),
      listBySession: vi.fn().mockResolvedValue({ entries: [] }),
      executionCreate: vi.fn(),
      subscribe: vi.fn().mockReturnValue(stream.generator),
      submitApproval: vi.fn().mockResolvedValue({}),
    };
    mockStigmer = createMockStigmer(methods);
  });

  it("attaches the worker once when a local session opens and detaches on close", async () => {
    const adapter = createMockAdapter();
    const { unmount } = renderHook(
      () => useSessionConversation("session-1", "org"),
      { wrapper: localWrapper(mockStigmer, adapter) },
    );

    // The session loads asynchronously; the worker attaches once loaded.
    await waitFor(() => {
      expect(adapter.onSessionOpened).toHaveBeenCalledWith("session-1");
    });
    expect(adapter.onSessionOpened).toHaveBeenCalledTimes(1);
    expect(adapter.onSessionClosed).not.toHaveBeenCalled();

    unmount();

    expect(adapter.onSessionClosed).toHaveBeenCalledTimes(1);
    expect(adapter.onSessionClosed).toHaveBeenCalledWith("session-1");
  });

  it("does not attach when no adapter is configured", async () => {
    // No adapter in the tree → no-op. Just verify the conversation still loads.
    const { result } = renderHook(
      () => useSessionConversation("session-1", "org"),
      {
        wrapper: function Wrapper({ children }: { children: ReactNode }) {
          return (
            <StigmerContext.Provider value={mockStigmer}>
              {children}
            </StigmerContext.Provider>
          );
        },
      },
    );

    await waitFor(() => {
      expect(result.current.session).not.toBeNull();
    });
  });
});

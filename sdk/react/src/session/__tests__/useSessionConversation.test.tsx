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
});

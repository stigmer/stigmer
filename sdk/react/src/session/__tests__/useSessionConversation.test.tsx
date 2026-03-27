import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApprovalAction, ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
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

function addPendingApproval(exec: AgentExecution, toolCallId: string) {
  const pa = create(PendingApprovalSchema);
  pa.toolCallId = toolCallId;
  pa.toolName = "test_tool";
  exec.status!.pendingApprovals.push(pa);
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

  // -------------------------------------------------------------------------
  // Task 3: Exponential backoff polling for missing approval data
  // -------------------------------------------------------------------------

  describe("approval poll backoff", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function renderWaitingHook(
      m: MockMethods,
      client: Stigmer,
      exec: AgentExecution,
    ) {
      m.listBySession.mockResolvedValue({ entries: [exec] });
      const pollStream = createControllableStream<AgentExecution>();
      m.subscribe.mockReturnValue(pollStream.generator);

      const hook = renderHook(
        () => useSessionConversation("session-1", "org"),
        { wrapper: createWrapper(client) },
      );

      await act(async () => {});
      act(() => {
        pollStream.push(exec);
      });
      await act(async () => {});

      return { ...hook, pollStream };
    }

    it("polls with exponential backoff when WAITING_FOR_APPROVAL with empty raw approvals", async () => {
      const exec = makeExecution(
        "e1",
        ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      );

      const { result } = await renderWaitingHook(methods, mockStigmer, exec);

      expect(result.current.activePhase).toBe(
        ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      );
      expect(result.current.pendingApprovals).toHaveLength(0);

      const baseline = methods.listBySession.mock.calls.length;

      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(methods.listBySession.mock.calls.length).toBe(baseline + 1);

      await act(async () => {
        vi.advanceTimersByTime(6000);
      });
      expect(methods.listBySession.mock.calls.length).toBe(baseline + 2);

      await act(async () => {
        vi.advanceTimersByTime(12000);
      });
      expect(methods.listBySession.mock.calls.length).toBe(baseline + 3);
    });

    it("stops polling when raw approvals arrive via stream", async () => {
      const exec = makeExecution(
        "e1",
        ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      );

      const { result, pollStream } = await renderWaitingHook(
        methods,
        mockStigmer,
        exec,
      );

      const baseline = methods.listBySession.mock.calls.length;

      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(methods.listBySession.mock.calls.length).toBe(baseline + 1);

      const updated = makeExecution(
        "e1",
        ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      );
      addPendingApproval(updated, "tc-1");
      act(() => {
        pollStream.push(updated);
      });
      await act(async () => {});

      expect(result.current.pendingApprovals).toHaveLength(1);

      const afterArrival = methods.listBySession.mock.calls.length;

      await act(async () => {
        vi.advanceTimersByTime(60000);
      });
      expect(methods.listBySession.mock.calls.length).toBe(afterArrival);
    });

    it("stops polling when phase transitions away", async () => {
      const exec = makeExecution(
        "e1",
        ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      );

      const { pollStream } = await renderWaitingHook(
        methods,
        mockStigmer,
        exec,
      );

      const completed = makeExecution(
        "e1",
        ExecutionPhase.EXECUTION_COMPLETED,
      );
      act(() => {
        pollStream.push(completed);
      });
      await act(async () => {});

      const afterTransition = methods.listBySession.mock.calls.length;

      await act(async () => {
        vi.advanceTimersByTime(60000);
      });
      // Terminal-phase effect fires one refetch; no further polling.
      expect(methods.listBySession.mock.calls.length).toBeLessThanOrEqual(
        afterTransition + 1,
      );
    });

    it("does not poll when raw approvals exist but are all dismissed", async () => {
      const exec = makeExecution(
        "e1",
        ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      );
      addPendingApproval(exec, "tc-1");

      const { result } = await renderWaitingHook(methods, mockStigmer, exec);

      expect(result.current.pendingApprovals).toHaveLength(1);

      await act(async () => {
        await result.current.submitApproval("tc-1", ApprovalAction.APPROVE);
      });
      expect(result.current.pendingApprovals).toHaveLength(0);

      const baseline = methods.listBySession.mock.calls.length;

      // At 3s (poll initial delay) — should NOT fire because raw approvals
      // are non-empty; only the staleness mechanism handles this case.
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(methods.listBySession.mock.calls.length).toBe(baseline);
    });

    it("cleans up timeout on unmount", async () => {
      const exec = makeExecution(
        "e1",
        ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      );

      const { unmount } = await renderWaitingHook(methods, mockStigmer, exec);

      const baseline = methods.listBySession.mock.calls.length;

      unmount();

      await act(async () => {
        vi.advanceTimersByTime(60000);
      });
      expect(methods.listBySession.mock.calls.length).toBe(baseline);
    });
  });

  // -------------------------------------------------------------------------
  // Task 4: Staleness detection for optimistic dismissals
  // -------------------------------------------------------------------------

  describe("staleness detection", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function renderWithApproval(
      m: MockMethods,
      client: Stigmer,
    ) {
      const exec = makeExecution(
        "e1",
        ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      );
      addPendingApproval(exec, "tc-1");
      m.listBySession.mockResolvedValue({ entries: [exec] });

      const testStream = createControllableStream<AgentExecution>();
      m.subscribe.mockReturnValue(testStream.generator);

      const hook = renderHook(
        () => useSessionConversation("session-1", "org"),
        { wrapper: createWrapper(client) },
      );

      await act(async () => {});
      act(() => {
        testStream.push(exec);
      });
      await act(async () => {});

      return { ...hook, testStream, exec };
    }

    it("reappears dismissed approval card after staleness threshold", async () => {
      const { result } = await renderWithApproval(methods, mockStigmer);

      expect(result.current.pendingApprovals).toHaveLength(1);

      await act(async () => {
        await result.current.submitApproval("tc-1", ApprovalAction.APPROVE);
      });
      expect(result.current.pendingApprovals).toHaveLength(0);
      expect(result.current.dismissedApprovalIds.has("tc-1")).toBe(true);

      // Before threshold: card stays hidden (15s covers interval ticks at 5s, 10s, 15s)
      await act(async () => {
        vi.advanceTimersByTime(15000);
      });
      expect(result.current.pendingApprovals).toHaveLength(0);

      // Past threshold: interval fires at 20s, age > 15s → stale → card reappears
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(result.current.pendingApprovals).toHaveLength(1);
      expect(result.current.dismissedApprovalIds.has("tc-1")).toBe(false);
    });

    it("does not run staleness check when phase is not WAITING_FOR_APPROVAL", async () => {
      const exec = makeExecution(
        "e1",
        ExecutionPhase.EXECUTION_IN_PROGRESS,
      );
      addPendingApproval(exec, "tc-1");
      methods.listBySession.mockResolvedValue({ entries: [exec] });

      const testStream = createControllableStream<AgentExecution>();
      methods.subscribe.mockReturnValue(testStream.generator);

      const { result } = renderHook(
        () => useSessionConversation("session-1", "org"),
        { wrapper: createWrapper(mockStigmer) },
      );

      await act(async () => {});
      act(() => {
        testStream.push(exec);
      });
      await act(async () => {});

      await act(async () => {
        await result.current.submitApproval("tc-1", ApprovalAction.APPROVE);
      });
      expect(result.current.dismissedApprovalIds.has("tc-1")).toBe(true);

      // Advance well past threshold — staleness detection should not run
      await act(async () => {
        vi.advanceTimersByTime(60000);
      });
      expect(result.current.dismissedApprovalIds.has("tc-1")).toBe(true);
    });

    it("triggers refetch when stale entries are detected", async () => {
      const { result } = await renderWithApproval(methods, mockStigmer);

      await act(async () => {
        await result.current.submitApproval("tc-1", ApprovalAction.APPROVE);
      });

      const baseline = methods.listBySession.mock.calls.length;

      // Advance to 20s — staleness fires, should call refetch
      await act(async () => {
        vi.advanceTimersByTime(20000);
      });
      expect(methods.listBySession.mock.calls.length).toBeGreaterThan(
        baseline,
      );
    });

    it("dismissedApprovalIds remains a ReadonlySet<string>", async () => {
      const { result } = await renderWithApproval(methods, mockStigmer);

      await act(async () => {
        await result.current.submitApproval("tc-1", ApprovalAction.APPROVE);
      });

      const ids = result.current.dismissedApprovalIds;
      expect(ids).toBeInstanceOf(Set);
      expect(ids.has("tc-1")).toBe(true);
      expect(typeof ids.has).toBe("function");
      // Verify it behaves as a Set (not a Map)
      expect([...ids]).toEqual(["tc-1"]);
    });

    it("resets dismissed state on new execution", async () => {
      const { result, testStream } = await renderWithApproval(
        methods,
        mockStigmer,
      );

      await act(async () => {
        await result.current.submitApproval("tc-1", ApprovalAction.APPROVE);
      });
      expect(result.current.dismissedApprovalIds.size).toBe(1);

      // Stream delivers terminal phase
      const completed = makeExecution(
        "e1",
        ExecutionPhase.EXECUTION_COMPLETED,
      );
      // Update mock so the refetch sees the completed execution — this
      // causes listActiveId to clear, which changes activeExecutionId
      // and triggers the dismissed-state reset effect.
      methods.listBySession.mockResolvedValue({ entries: [completed] });
      act(() => {
        testStream.push(completed);
      });
      await act(async () => {});

      expect(result.current.dismissedApprovalIds.size).toBe(0);
    });
  });
});

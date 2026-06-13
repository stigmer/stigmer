import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { create } from "@bufbuild/protobuf";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import {
  WorkflowExecutionEventSchema,
  WorkflowEventType,
  TaskStartedPayloadSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { StigmerContext } from "../../context";
import { WorkflowExecutionEventStore } from "../../internal/store";
import {
  useWorkflowExecutionEventStream,
  isRecoveryTransition,
} from "../useWorkflowExecutionEventStream";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

const PHASE = {
  PENDING: ExecutionPhase.EXECUTION_PENDING,
  IN_PROGRESS: ExecutionPhase.EXECUTION_IN_PROGRESS,
  COMPLETED: ExecutionPhase.EXECUTION_COMPLETED,
  FAILED: ExecutionPhase.EXECUTION_FAILED,
  CANCELLED: ExecutionPhase.EXECUTION_CANCELLED,
  TERMINATED: ExecutionPhase.EXECUTION_TERMINATED,
} as const;

function makeMockClient(overrides?: {
  getEventLog?: (...args: any[]) => Promise<any>;
  subscribeEvents?: (...args: any[]) => AsyncGenerator<any>;
}) {
  const getEventLog = overrides?.getEventLog ?? vi.fn(async () => ({
    events: [],
    hasMore: false,
    latestSequence: BigInt(0),
  }));

  const subscribeEvents = overrides?.subscribeEvents ?? vi.fn(
    async function* () { /* no events */ },
  );

  return {
    workflowExecution: { getEventLog, subscribeEvents },
  } as any;
}

function createWrapper(client: any) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(StigmerContext.Provider, { value: client }, children);
  };
}

function makeTaskStartedEvent(
  seq: number,
  taskName: string,
): WorkflowExecutionEvent {
  return create(WorkflowExecutionEventSchema, {
    eventId: `evt-${seq}`,
    sequenceNumber: BigInt(seq),
    occurredAt: "2026-06-02T00:00:00Z",
    taskName,
    eventType: WorkflowEventType.task_started,
    payload: {
      case: "taskStarted",
      value: create(TaskStartedPayloadSchema, { taskKind: 1, attemptNumber: 1 }),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// isRecoveryTransition — pure function tests
// ---------------------------------------------------------------------------

describe("isRecoveryTransition", () => {
  it.each([
    { prev: PHASE.FAILED, next: PHASE.IN_PROGRESS, label: "FAILED → IN_PROGRESS" },
    { prev: PHASE.COMPLETED, next: PHASE.IN_PROGRESS, label: "COMPLETED → IN_PROGRESS" },
    { prev: PHASE.CANCELLED, next: PHASE.IN_PROGRESS, label: "CANCELLED → IN_PROGRESS" },
    { prev: PHASE.TERMINATED, next: PHASE.IN_PROGRESS, label: "TERMINATED → IN_PROGRESS" },
  ])("returns true for $label (terminal → active)", ({ prev, next }) => {
    expect(isRecoveryTransition(prev, next)).toBe(true);
  });

  it.each([
    { prev: PHASE.IN_PROGRESS, next: PHASE.FAILED, label: "IN_PROGRESS → FAILED" },
    { prev: PHASE.IN_PROGRESS, next: PHASE.COMPLETED, label: "IN_PROGRESS → COMPLETED" },
    { prev: undefined, next: PHASE.IN_PROGRESS, label: "undefined → IN_PROGRESS (initial load)" },
    { prev: PHASE.FAILED, next: undefined, label: "FAILED → undefined (unresolved)" },
    { prev: undefined, next: undefined, label: "undefined → undefined" },
    { prev: PHASE.FAILED, next: PHASE.FAILED, label: "FAILED → FAILED (same terminal)" },
  ])("returns false for $label", ({ prev, next }) => {
    expect(isRecoveryTransition(prev, next)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hook integration tests
// ---------------------------------------------------------------------------

describe("useWorkflowExecutionEventStream", () => {
  it("subscribes via subscribeEvents for non-terminal phase", async () => {
    const subscribeEvents = vi.fn(async function* () {});
    const client = makeMockClient({ subscribeEvents });

    const { result } = renderHook(
      () =>
        useWorkflowExecutionEventStream("wex-001", {
          executionPhase: PHASE.IN_PROGRESS,
        }),
      { wrapper: createWrapper(client) },
    );

    await flush();
    expect(subscribeEvents).toHaveBeenCalledTimes(1);
    expect(result.current.events).toHaveLength(0);
  });

  it("batch-loads via getEventLog for terminal phase", async () => {
    const getEventLog = vi.fn(async () => ({
      events: [],
      hasMore: false,
      latestSequence: BigInt(0),
    }));
    const client = makeMockClient({ getEventLog });

    renderHook(
      () =>
        useWorkflowExecutionEventStream("wex-001", {
          executionPhase: PHASE.FAILED,
        }),
      { wrapper: createWrapper(client) },
    );

    await flush();
    expect(getEventLog).toHaveBeenCalledTimes(1);
  });

  it("resets store on recovery (FAILED → IN_PROGRESS)", async () => {
    const store = new WorkflowExecutionEventStore();
    const getEventLog = vi.fn(async () => ({
      events: [],
      hasMore: false,
      latestSequence: BigInt(5),
    }));
    const subscribeEvents = vi.fn(async function* () {});
    const client = makeMockClient({ getEventLog, subscribeEvents });

    let phase = PHASE.FAILED as ExecutionPhase;

    const { result, rerender } = renderHook(
      () =>
        useWorkflowExecutionEventStream("wex-001", {
          executionPhase: phase,
          store,
        }),
      { wrapper: createWrapper(client) },
    );

    await flush();

    // Store should have batch-loaded (terminal phase)
    expect(getEventLog).toHaveBeenCalledTimes(1);
    expect(store.getStreamState().stage).toBe("complete");

    // Manually seed the store to simulate events from the failed run
    const resetSpy = vi.spyOn(store, "reset");

    // Simulate recovery: phase changes to IN_PROGRESS
    phase = PHASE.IN_PROGRESS;
    rerender();
    await flush();

    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(subscribeEvents).toHaveBeenCalledTimes(1);

    // After reset, subscription starts from sequence 0
    const subscribeCall = (subscribeEvents.mock.calls as unknown[][])[0]?.[0] as
      | { afterSequence: bigint }
      | undefined;
    expect(subscribeCall?.afterSequence).toBe(BigInt(0));
  });

  it("does NOT reset on normal completion (IN_PROGRESS → COMPLETED)", async () => {
    const store = new WorkflowExecutionEventStore();
    const subscribeEvents = vi.fn(async function* () {});
    const getEventLog = vi.fn(async () => ({
      events: [],
      hasMore: false,
      latestSequence: BigInt(0),
    }));
    const client = makeMockClient({ subscribeEvents, getEventLog });

    let phase = PHASE.IN_PROGRESS as ExecutionPhase;

    const { rerender } = renderHook(
      () =>
        useWorkflowExecutionEventStream("wex-001", {
          executionPhase: phase,
          store,
        }),
      { wrapper: createWrapper(client) },
    );

    await flush();

    const resetSpy = vi.spyOn(store, "reset");

    // Execution completes normally
    phase = PHASE.COMPLETED;
    rerender();
    await flush();

    expect(resetSpy).not.toHaveBeenCalled();
  });

  it("does NOT reset on initial load (undefined → FAILED)", async () => {
    const store = new WorkflowExecutionEventStore();
    const getEventLog = vi.fn(async () => ({
      events: [],
      hasMore: false,
      latestSequence: BigInt(0),
    }));
    const client = makeMockClient({ getEventLog });

    let phase: ExecutionPhase | undefined = undefined;

    const { rerender } = renderHook(
      () =>
        useWorkflowExecutionEventStream("wex-001", {
          executionPhase: phase,
          store,
        }),
      { wrapper: createWrapper(client) },
    );

    await flush();

    const resetSpy = vi.spyOn(store, "reset");

    // Phase resolves to terminal — initial load, not recovery
    phase = PHASE.FAILED;
    rerender();
    await flush();

    expect(resetSpy).not.toHaveBeenCalled();
  });

  it("resets store when executionId becomes null", async () => {
    const store = new WorkflowExecutionEventStore();
    const subscribeEvents = vi.fn(async function* () {});
    const client = makeMockClient({ subscribeEvents });

    let execId: string | null = "wex-001";

    const { result, rerender } = renderHook(
      () =>
        useWorkflowExecutionEventStream(execId, {
          executionPhase: PHASE.IN_PROGRESS,
          store,
        }),
      { wrapper: createWrapper(client) },
    );

    await flush();

    // Null out executionId
    execId = null;
    rerender();
    await flush();

    expect(store.getStreamState().stage).toBe("idle");
    expect(result.current.events).toHaveLength(0);
  });

  it("reconnect does NOT reset store (preserves accumulated events)", async () => {
    const store = new WorkflowExecutionEventStore();
    const subscribeEvents = vi.fn(async function* () {});
    const client = makeMockClient({ subscribeEvents });

    const { result } = renderHook(
      () =>
        useWorkflowExecutionEventStream("wex-001", {
          executionPhase: PHASE.IN_PROGRESS,
          store,
        }),
      { wrapper: createWrapper(client) },
    );

    await flush();

    const resetSpy = vi.spyOn(store, "reset");

    // Reconnect
    act(() => {
      result.current.reconnect();
    });
    await flush();

    expect(resetSpy).not.toHaveBeenCalled();
    expect(subscribeEvents).toHaveBeenCalledTimes(2);
  });

  it("resets the store when switching to a different execution (terminal A → live B)", async () => {
    const store = new WorkflowExecutionEventStore();
    const getEventLog = vi.fn(async () => ({
      events: [
        makeTaskStartedEvent(1, "task-a"),
        makeTaskStartedEvent(2, "task-b"),
        makeTaskStartedEvent(3, "task-c"),
      ],
      hasMore: false,
      latestSequence: BigInt(3),
    }));
    const subscribeEvents = vi.fn(async function* () {});
    const client = makeMockClient({ getEventLog, subscribeEvents });

    let execId = "wex-001";
    let phase = PHASE.COMPLETED as ExecutionPhase;

    const { result, rerender } = renderHook(
      () =>
        useWorkflowExecutionEventStream(execId, {
          executionPhase: phase,
          store,
        }),
      { wrapper: createWrapper(client) },
    );

    await flush();

    // Execution A's events are loaded.
    expect(result.current.events).toHaveLength(3);

    const resetSpy = vi.spyOn(store, "reset");

    // Switch to a different, still-running execution.
    execId = "wex-002";
    phase = PHASE.IN_PROGRESS;
    rerender();
    await flush();

    // Store reset exactly once (the switch) — NOT twice, which would mean
    // the terminal→active phase delta was mis-read as a recovery.
    expect(resetSpy).toHaveBeenCalledTimes(1);
    // A's events are gone.
    expect(result.current.events).toHaveLength(0);
    // B's live subscription starts from sequence 0 — it does NOT resume
    // from A's latest sequence, which would silently drop B's early events.
    expect(subscribeEvents).toHaveBeenCalledTimes(1);
    const subscribeCall = (subscribeEvents.mock.calls as unknown[][])[0]?.[0] as
      | { afterSequence: bigint }
      | undefined;
    expect(subscribeCall?.afterSequence).toBe(BigInt(0));
  });

  it("shows the new execution's events when switching between two terminal executions", async () => {
    const store = new WorkflowExecutionEventStore();
    // Both executions share sequence numbers (1..n). Without a reset on
    // switch, the append-only store's sequence-dedup would drop B's events
    // (seq <= A's max) and keep showing A's — the reported bug.
    const getEventLog = vi.fn(async (req: { executionId: string }) => {
      const taskName = req.executionId === "wex-001" ? "alpha" : "beta";
      return {
        events: [makeTaskStartedEvent(1, taskName)],
        hasMore: false,
        latestSequence: BigInt(1),
      };
    });
    const client = makeMockClient({ getEventLog });

    let execId = "wex-001";

    const { result, rerender } = renderHook(
      () =>
        useWorkflowExecutionEventStream(execId, {
          executionPhase: PHASE.COMPLETED,
          store,
        }),
      { wrapper: createWrapper(client) },
    );

    await flush();

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]?.taskName).toBe("alpha");

    // Switch to a second completed execution.
    execId = "wex-002";
    rerender();
    await flush();

    // B re-batch-loads from sequence 0 for its own id and the view shows
    // B's events, not A's stale ones.
    expect(getEventLog).toHaveBeenCalledTimes(2);
    const secondCall = (getEventLog.mock.calls as unknown[][])[1]?.[0] as {
      executionId: string;
      afterSequence: bigint;
    };
    expect(secondCall.executionId).toBe("wex-002");
    expect(secondCall.afterSequence).toBe(BigInt(0));
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]?.taskName).toBe("beta");
  });
});

// ---------------------------------------------------------------------------
// Auto-reconnect (#174)
// ---------------------------------------------------------------------------

describe("useWorkflowExecutionEventStream — auto-reconnect", () => {
  it("auto-reconnects on a transient drop and resumes from the latest sequence", async () => {
    let call = 0;
    const subscribeEvents = vi.fn((_req: any) => {
      call += 1;
      if (call === 1) {
        return (async function* () {
          yield makeTaskStartedEvent(5, "t5");
          throw new TypeError("Load failed");
        })();
      }
      return (async function* () {
        yield makeTaskStartedEvent(6, "t6");
      })();
    });
    const client = makeMockClient({ subscribeEvents });

    const { result } = renderHook(
      () =>
        useWorkflowExecutionEventStream("wex-001", {
          executionPhase: PHASE.IN_PROGRESS,
          reconnectOptions: { baseDelayMs: 5, maxDelayMs: 5 },
        }),
      { wrapper: createWrapper(client) },
    );

    await waitFor(() => expect(subscribeEvents).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.events).toHaveLength(2));

    // The resumed subscription continues after the last received sequence (5),
    // so no events are lost or duplicated.
    const secondReq = (subscribeEvents.mock.calls as unknown[][])[1]?.[0] as {
      afterSequence: bigint;
    };
    expect(secondReq.afterSequence).toBe(BigInt(5));
    expect(result.current.error).toBeNull();
  });

  it("surfaces an error after exhausting reconnect attempts", async () => {
    const subscribeEvents = vi.fn(
      () =>
        (async function* () {
          throw new TypeError("Load failed");
        })(),
    );
    const client = makeMockClient({ subscribeEvents });

    const { result } = renderHook(
      () =>
        useWorkflowExecutionEventStream("wex-001", {
          executionPhase: PHASE.IN_PROGRESS,
          reconnectOptions: { baseDelayMs: 1, maxDelayMs: 1, maxAttempts: 2 },
        }),
      { wrapper: createWrapper(client) },
    );

    await waitFor(() => expect(result.current.error).not.toBeNull(), {
      timeout: 2000,
    });
    expect(result.current.streamState.stage).toBe("error");
    // 1 initial attempt + 2 retries.
    expect(subscribeEvents).toHaveBeenCalledTimes(3);
  });

  it("marks unsupported on UNIMPLEMENTED without retrying", async () => {
    const subscribeEvents = vi.fn(
      () =>
        (async function* () {
          throw new Error("UNIMPLEMENTED: event streaming not supported");
        })(),
    );
    const client = makeMockClient({ subscribeEvents });

    const { result } = renderHook(
      () =>
        useWorkflowExecutionEventStream("wex-001", {
          executionPhase: PHASE.IN_PROGRESS,
          reconnectOptions: { baseDelayMs: 1, maxDelayMs: 1 },
        }),
      { wrapper: createWrapper(client) },
    );

    await waitFor(() =>
      expect(result.current.streamState.stage).toBe("unsupported"),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(subscribeEvents).toHaveBeenCalledTimes(1);
  });

  it("treats a clean stream end as completion (never a reconnect loop)", async () => {
    const subscribeEvents = vi.fn(async function* () {
      /* no events, then clean end */
    });
    const client = makeMockClient({ subscribeEvents });

    const { result } = renderHook(
      () =>
        useWorkflowExecutionEventStream("wex-001", {
          executionPhase: PHASE.IN_PROGRESS,
          reconnectOptions: { baseDelayMs: 1, maxDelayMs: 1 },
        }),
      { wrapper: createWrapper(client) },
    );

    await waitFor(() =>
      expect(result.current.streamState.stage).toBe("complete"),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(subscribeEvents).toHaveBeenCalledTimes(1);
  });
});

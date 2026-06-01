import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
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
});

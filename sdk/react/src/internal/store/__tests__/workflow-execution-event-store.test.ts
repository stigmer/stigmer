import { describe, it, expect, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import type { JsonObject } from "@bufbuild/protobuf";
import {
  WorkflowExecutionEventSchema,
  WorkflowEventType,
  TaskStartedPayloadSchema,
  TaskCompletedPayloadSchema,
  TaskFailedPayloadSchema,
  AgentCallStartedPayloadSchema,
  AgentCallProgressPayloadSchema,
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { ExecutionPhase as AgentExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { WorkflowExecutionEventStore } from "../workflow-execution-event-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTaskStartedEvent(
  seq: number,
  taskName: string,
  opts: {
    taskKind?: number;
    attemptNumber?: number;
    inputSummary?: JsonObject;
  } = {},
): WorkflowExecutionEvent {
  return create(WorkflowExecutionEventSchema, {
    eventId: `evt-${seq}`,
    sequenceNumber: BigInt(seq),
    occurredAt: "2026-05-22T00:00:00Z",
    taskName,
    eventType: WorkflowEventType.task_started,
    payload: {
      case: "taskStarted",
      value: create(TaskStartedPayloadSchema, {
        taskKind: opts.taskKind ?? 1,
        attemptNumber: opts.attemptNumber ?? 1,
        inputSummary: opts.inputSummary,
      }),
    },
  });
}

function makeTaskCompletedEvent(
  seq: number,
  taskName: string,
  opts: {
    durationMs?: bigint;
    costMicros?: bigint;
    tokensUsed?: bigint;
    outputSummary?: JsonObject;
  } = {},
): WorkflowExecutionEvent {
  return create(WorkflowExecutionEventSchema, {
    eventId: `evt-${seq}`,
    sequenceNumber: BigInt(seq),
    occurredAt: "2026-05-22T00:00:00Z",
    taskName,
    eventType: WorkflowEventType.task_completed,
    payload: {
      case: "taskCompleted",
      value: create(TaskCompletedPayloadSchema, {
        taskKind: 1,
        durationMs: opts.durationMs ?? BigInt(100),
        costMicros: opts.costMicros ?? BigInt(500),
        tokensUsed: opts.tokensUsed ?? BigInt(200),
        outputSummary: opts.outputSummary,
      }),
    },
  });
}

function makeApprovalRequestedEvent(
  seq: number,
  taskName: string,
  prompt = "Please review",
): WorkflowExecutionEvent {
  return create(WorkflowExecutionEventSchema, {
    eventId: `evt-${seq}`,
    sequenceNumber: BigInt(seq),
    occurredAt: "2026-05-22T00:00:00Z",
    taskName,
    eventType: WorkflowEventType.approval_requested,
    payload: {
      case: "approvalRequested",
      value: create(ApprovalRequestedPayloadSchema, { prompt }),
    },
  });
}

function makeApprovalResolvedEvent(
  seq: number,
  taskName: string,
  opts: { resolvedBy?: string; waitDurationMs?: bigint } = {},
): WorkflowExecutionEvent {
  return create(WorkflowExecutionEventSchema, {
    eventId: `evt-${seq}`,
    sequenceNumber: BigInt(seq),
    occurredAt: "2026-05-22T00:00:00Z",
    taskName,
    eventType: WorkflowEventType.approval_resolved,
    payload: {
      case: "approvalResolved",
      value: create(ApprovalResolvedPayloadSchema, {
        resolvedBy: opts.resolvedBy ?? "alice",
        waitDurationMs: opts.waitDurationMs ?? BigInt(5000),
      }),
    },
  });
}

function makeTaskFailedEvent(
  seq: number,
  taskName: string,
  opts: { willRetry?: boolean; attemptNumber?: number; error?: string } = {},
): WorkflowExecutionEvent {
  return create(WorkflowExecutionEventSchema, {
    eventId: `evt-${seq}`,
    sequenceNumber: BigInt(seq),
    occurredAt: "2026-05-22T00:00:00Z",
    taskName,
    eventType: WorkflowEventType.task_failed,
    payload: {
      case: "taskFailed",
      value: create(TaskFailedPayloadSchema, {
        taskKind: WorkflowTaskKind.agent_call,
        willRetry: opts.willRetry ?? false,
        attemptNumber: opts.attemptNumber ?? 1,
        error: opts.error ?? "boom",
        durationMs: BigInt(100),
      }),
    },
  });
}

function makeAgentCallStartedEvent(
  seq: number,
  taskName: string,
  opts: { childExecutionId?: string; agentSlug?: string } = {},
): WorkflowExecutionEvent {
  return create(WorkflowExecutionEventSchema, {
    eventId: `evt-${seq}`,
    sequenceNumber: BigInt(seq),
    occurredAt: "2026-05-22T00:00:00Z",
    taskName,
    eventType: WorkflowEventType.agent_call_started,
    payload: {
      case: "agentCallStarted",
      value: create(AgentCallStartedPayloadSchema, {
        childExecutionId: opts.childExecutionId ?? "aex_child_1",
        agentSlug: opts.agentSlug ?? "helper",
        messageSummary: "do the thing",
      }),
    },
  });
}

/**
 * The REAL event shape the call-agent orchestrator emits on its 15s poll —
 * `agentPhase` is the child AgentExecution's phase. The store derives the
 * parent task's `waiting_approval` state from it (child gates are surfaced
 * snapshot-only; no approval_requested event exists for agent_call tasks).
 */
function makeAgentCallProgressEvent(
  seq: number,
  taskName: string,
  agentPhase: AgentExecutionPhase,
  opts: { childExecutionId?: string; currentToolName?: string } = {},
): WorkflowExecutionEvent {
  return create(WorkflowExecutionEventSchema, {
    eventId: `evt-${seq}`,
    sequenceNumber: BigInt(seq),
    occurredAt: "2026-05-22T00:00:00Z",
    taskName,
    eventType: WorkflowEventType.agent_call_progress,
    payload: {
      case: "agentCallProgress",
      value: create(AgentCallProgressPayloadSchema, {
        childExecutionId: opts.childExecutionId ?? "aex_child_1",
        agentPhase,
        currentToolName: opts.currentToolName ?? "",
        tokensConsumed: BigInt(0),
        messagesCount: 0,
        toolCallsCount: 0,
      }),
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkflowExecutionEventStore", () => {
  describe("appendEvents", () => {
    it("appends new events and notifies listeners", () => {
      const store = new WorkflowExecutionEventStore();
      const listener = vi.fn();
      store.subscribe(listener);

      const events = [makeTaskStartedEvent(1, "build")];
      store.appendEvents(events);

      expect(store.getEvents()).toHaveLength(1);
      expect(store.getEvents()[0].taskName).toBe("build");
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("deduplicates by sequence number (events with seq <= current max are dropped)", () => {
      const store = new WorkflowExecutionEventStore();

      store.appendEvents([
        makeTaskStartedEvent(1, "build"),
        makeTaskStartedEvent(2, "test"),
      ]);
      expect(store.getEvents()).toHaveLength(2);

      const listener = vi.fn();
      store.subscribe(listener);

      store.appendEvents([
        makeTaskStartedEvent(1, "duplicate"),
        makeTaskStartedEvent(2, "duplicate"),
      ]);

      expect(store.getEvents()).toHaveLength(2);
      expect(listener).not.toHaveBeenCalled();
    });

    it("sorts appended events by sequence number", () => {
      const store = new WorkflowExecutionEventStore();

      store.appendEvents([
        makeTaskStartedEvent(3, "third"),
        makeTaskStartedEvent(1, "first"),
        makeTaskStartedEvent(2, "second"),
      ]);

      const events = store.getEvents();
      expect(events[0].sequenceNumber).toBe(BigInt(1));
      expect(events[1].sequenceNumber).toBe(BigInt(2));
      expect(events[2].sequenceNumber).toBe(BigInt(3));
    });

    it("invalidates taskStates cache on append", () => {
      const store = new WorkflowExecutionEventStore();

      store.appendEvents([makeTaskStartedEvent(1, "build")]);
      const states1 = store.getTaskStates();
      expect(states1.get("build")?.status).toBe("running");

      store.appendEvents([makeTaskCompletedEvent(2, "build")]);
      const states2 = store.getTaskStates();
      expect(states2.get("build")?.status).toBe("completed");

      expect(states1).not.toBe(states2);
    });
  });

  describe("deriveTaskStates — approval lifecycle", () => {
    it("taskStarted sets status to running", () => {
      const store = new WorkflowExecutionEventStore();
      store.appendEvents([makeTaskStartedEvent(1, "reviewGate", { taskKind: 16 })]);

      const states = store.getTaskStates();
      const task = states.get("reviewGate");
      expect(task).toBeDefined();
      expect(task!.status).toBe("running");
      expect(task!.taskName).toBe("reviewGate");
    });

    it("approvalRequested transitions from running to waiting_approval", () => {
      const store = new WorkflowExecutionEventStore();
      store.appendEvents([
        makeTaskStartedEvent(1, "reviewGate", { taskKind: 16 }),
        makeApprovalRequestedEvent(2, "reviewGate"),
      ]);

      const states = store.getTaskStates();
      expect(states.get("reviewGate")!.status).toBe("waiting_approval");
    });

    it("approvalResolved transitions from waiting_approval back to running", () => {
      const store = new WorkflowExecutionEventStore();
      store.appendEvents([
        makeTaskStartedEvent(1, "reviewGate", { taskKind: 16 }),
        makeApprovalRequestedEvent(2, "reviewGate"),
        makeApprovalResolvedEvent(3, "reviewGate"),
      ]);

      const states = store.getTaskStates();
      expect(states.get("reviewGate")!.status).toBe("running");
    });

    it("approvalResolved is no-op when task is not in waiting_approval", () => {
      const store = new WorkflowExecutionEventStore();
      store.appendEvents([
        makeTaskStartedEvent(1, "reviewGate", { taskKind: 16 }),
        makeApprovalResolvedEvent(2, "reviewGate"),
      ]);

      const states = store.getTaskStates();
      expect(states.get("reviewGate")!.status).toBe("running");
    });

    it("full lifecycle: taskStarted → approvalRequested → approvalResolved → taskCompleted", () => {
      const store = new WorkflowExecutionEventStore();
      store.appendEvents([
        makeTaskStartedEvent(1, "reviewGate", { taskKind: 16 }),
        makeApprovalRequestedEvent(2, "reviewGate"),
        makeApprovalResolvedEvent(3, "reviewGate"),
        makeTaskCompletedEvent(4, "reviewGate"),
      ]);

      const states = store.getTaskStates();
      const task = states.get("reviewGate")!;
      expect(task.status).toBe("completed");
      expect(task.durationMs).toBe(100);
      expect(task.costMicros).toBe(BigInt(500));
    });

    it("approvalRequested without prior taskStarted is no-op (prev is undefined)", () => {
      const store = new WorkflowExecutionEventStore();
      store.appendEvents([makeApprovalRequestedEvent(1, "unknownTask")]);

      const states = store.getTaskStates();
      expect(states.has("unknownTask")).toBe(false);
    });
  });

  // Child gates are surfaced snapshot-only (no approval_requested event for
  // agent_call tasks) — the parent task's waiting_approval state is DERIVED
  // from the child phase carried on agent_call_progress events. These tests
  // pin every transition of that derivation (D-T02-14).
  describe("deriveTaskStates — child-gate derivation from agent_call_progress", () => {
    const AGENT_CALL = { taskKind: WorkflowTaskKind.agent_call };

    /** A running agent_call task bound to its child — the common arrange. */
    function runningAgentCall(store: WorkflowExecutionEventStore, task = "call-helper") {
      store.appendEvents([
        makeTaskStartedEvent(1, task, AGENT_CALL),
        makeAgentCallStartedEvent(2, task),
      ]);
    }

    it("child phase WAITING_FOR_APPROVAL gates a running task", () => {
      const store = new WorkflowExecutionEventStore();
      runningAgentCall(store);
      store.appendEvents([
        makeAgentCallProgressEvent(3, "call-helper", AgentExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL),
      ]);

      const task = store.getTaskStates().get("call-helper")!;
      expect(task.status).toBe("waiting_approval");
      // The status flip must not drop the merged progress fields.
      expect(task.childExecutionId).toBe("aex_child_1");
      expect(task.agentSlug).toBe("helper");
    });

    it("child phase IN_PROGRESS un-gates a waiting task (child resumed)", () => {
      const store = new WorkflowExecutionEventStore();
      runningAgentCall(store);
      store.appendEvents([
        makeAgentCallProgressEvent(3, "call-helper", AgentExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL),
        makeAgentCallProgressEvent(4, "call-helper", AgentExecutionPhase.EXECUTION_IN_PROGRESS),
      ]);

      expect(store.getTaskStates().get("call-helper")!.status).toBe("running");
    });

    it("phase UNSPECIFIED never un-gates a waiting task (the orchestrator's null-progress emits carry phase 0)", () => {
      const store = new WorkflowExecutionEventStore();
      runningAgentCall(store);
      store.appendEvents([
        makeAgentCallProgressEvent(3, "call-helper", AgentExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL),
        makeAgentCallProgressEvent(4, "call-helper", AgentExecutionPhase.EXECUTION_PHASE_UNSPECIFIED),
      ]);

      expect(store.getTaskStates().get("call-helper")!.status).toBe("waiting_approval");
    });

    it("non-waiting phases leave a running task running (PENDING and UNSPECIFIED are not gates)", () => {
      const store = new WorkflowExecutionEventStore();
      runningAgentCall(store);
      store.appendEvents([
        makeAgentCallProgressEvent(3, "call-helper", AgentExecutionPhase.EXECUTION_PHASE_UNSPECIFIED),
        makeAgentCallProgressEvent(4, "call-helper", AgentExecutionPhase.EXECUTION_PENDING),
        makeAgentCallProgressEvent(5, "call-helper", AgentExecutionPhase.EXECUTION_IN_PROGRESS),
      ]);

      expect(store.getTaskStates().get("call-helper")!.status).toBe("running");
    });

    it("taskCompleted settles a gated task (the task's own events stay authoritative)", () => {
      const store = new WorkflowExecutionEventStore();
      runningAgentCall(store);
      store.appendEvents([
        makeAgentCallProgressEvent(3, "call-helper", AgentExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL),
        makeTaskCompletedEvent(4, "call-helper"),
      ]);

      expect(store.getTaskStates().get("call-helper")!.status).toBe("completed");
    });

    it("a stale WAITING progress event cannot re-gate a settled task", () => {
      const store = new WorkflowExecutionEventStore();
      runningAgentCall(store);
      store.appendEvents([
        makeTaskCompletedEvent(3, "call-helper"),
        makeAgentCallProgressEvent(4, "call-helper", AgentExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL),
      ]);

      expect(store.getTaskStates().get("call-helper")!.status).toBe("completed");
    });

    it("a WAITING progress event cannot clobber a retrying task", () => {
      const store = new WorkflowExecutionEventStore();
      runningAgentCall(store);
      store.appendEvents([
        makeTaskFailedEvent(3, "call-helper", { willRetry: true }),
        makeAgentCallProgressEvent(4, "call-helper", AgentExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL),
      ]);

      expect(store.getTaskStates().get("call-helper")!.status).toBe("retrying");
    });

    it("terminal child phase on progress un-gates; task settlement follows from task events", () => {
      const store = new WorkflowExecutionEventStore();
      runningAgentCall(store);
      store.appendEvents([
        makeAgentCallProgressEvent(3, "call-helper", AgentExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL),
        makeAgentCallProgressEvent(4, "call-helper", AgentExecutionPhase.EXECUTION_COMPLETED),
      ]);
      expect(store.getTaskStates().get("call-helper")!.status).toBe("running");

      store.appendEvents([makeTaskCompletedEvent(5, "call-helper")]);
      expect(store.getTaskStates().get("call-helper")!.status).toBe("completed");
    });

    it("replaying a terminal history ends settled, not gated (history replay is safe)", () => {
      const store = new WorkflowExecutionEventStore();
      store.appendEvents([
        makeTaskStartedEvent(1, "call-helper", AGENT_CALL),
        makeAgentCallStartedEvent(2, "call-helper"),
        makeAgentCallProgressEvent(3, "call-helper", AgentExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL),
        makeAgentCallProgressEvent(4, "call-helper", AgentExecutionPhase.EXECUTION_IN_PROGRESS),
        makeTaskCompletedEvent(5, "call-helper"),
      ]);

      expect(store.getTaskStates().get("call-helper")!.status).toBe("completed");
    });

    it("a progress event without a prior taskStarted is a no-op (prev is undefined)", () => {
      const store = new WorkflowExecutionEventStore();
      store.appendEvents([
        makeAgentCallProgressEvent(1, "ghost", AgentExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL),
      ]);

      expect(store.getTaskStates().has("ghost")).toBe(false);
    });
  });

  describe("subscribe / reset", () => {
    it("subscribe returns unsubscribe function", () => {
      const store = new WorkflowExecutionEventStore();
      const listener = vi.fn();
      const unsub = store.subscribe(listener);

      store.appendEvents([makeTaskStartedEvent(1, "build")]);
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      store.appendEvents([makeTaskCompletedEvent(2, "build")]);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("reset clears events, stream state, and caches", () => {
      const store = new WorkflowExecutionEventStore();
      store.appendEvents([makeTaskStartedEvent(1, "build")]);
      store.setStreamState({ stage: "streaming", executionId: "exec-1" });

      store.reset();

      expect(store.getEvents()).toHaveLength(0);
      expect(store.getStreamState()).toEqual({ stage: "idle" });
      expect(store.getTaskStates().size).toBe(0);
      expect(store.getLatestSequence()).toBe(BigInt(0));
    });

    it("reset notifies listeners", () => {
      const store = new WorkflowExecutionEventStore();
      store.appendEvents([makeTaskStartedEvent(1, "build")]);

      const listener = vi.fn();
      store.subscribe(listener);

      store.reset();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // T04: the truncated I/O summaries are the live preview source for the
  // thread cards — the store must capture them, reset them correctly on
  // retries, and keep them REFERENCE-STABLE across re-derivations (the
  // projection's structural sharing compares them by identity).
  describe("I/O summary capture (T04)", () => {
    it("captures input_summary from task_started and output_summary from task_completed", () => {
      const store = new WorkflowExecutionEventStore();
      store.appendEvents([
        makeTaskStartedEvent(1, "seed", {
          inputSummary: { variables: { order_id: "o-1" } },
        }),
        makeTaskCompletedEvent(2, "seed", {
          outputSummary: { result: 42 },
        }),
      ]);

      const state = store.getTaskStates().get("seed")!;
      expect(state.inputSummary).toEqual({ variables: { order_id: "o-1" } });
      expect(state.outputSummary).toEqual({ result: 42 });
    });

    it("defaults both summaries to null when the payloads omit them", () => {
      const store = new WorkflowExecutionEventStore();
      store.appendEvents([
        makeTaskStartedEvent(1, "seed"),
        makeTaskCompletedEvent(2, "seed"),
      ]);

      const state = store.getTaskStates().get("seed")!;
      expect(state.inputSummary).toBeNull();
      expect(state.outputSummary).toBeNull();
    });

    it("a restart invalidates the prior attempt's output but keeps the input", () => {
      const store = new WorkflowExecutionEventStore();
      store.appendEvents([
        makeTaskStartedEvent(1, "flaky", { inputSummary: { url: "a" } }),
        makeTaskCompletedEvent(2, "flaky", { outputSummary: { ok: true } }),
        // The engine re-runs the task (e.g. a workflow-level replay).
        makeTaskStartedEvent(3, "flaky", { attemptNumber: 2 }),
      ]);

      const state = store.getTaskStates().get("flaky")!;
      expect(state.outputSummary).toBeNull();
      expect(state.inputSummary).toEqual({ url: "a" });
    });

    it("a failure clears the output summary but keeps the input", () => {
      const store = new WorkflowExecutionEventStore();
      store.appendEvents([
        makeTaskStartedEvent(1, "doomed", { inputSummary: { url: "a" } }),
        makeTaskFailedEvent(2, "doomed"),
      ]);

      const state = store.getTaskStates().get("doomed")!;
      expect(state.inputSummary).toEqual({ url: "a" });
      expect(state.outputSummary).toBeNull();
    });

    it("keeps summary references stable across re-derivations (structural-sharing contract)", () => {
      const store = new WorkflowExecutionEventStore();
      store.appendEvents([
        makeTaskStartedEvent(1, "seed", { inputSummary: { a: 1 } }),
        makeTaskCompletedEvent(2, "seed", { outputSummary: { b: 2 } }),
      ]);
      const before = store.getTaskStates().get("seed")!;

      // A later event for ANOTHER task invalidates the cache and forces a
      // full re-derivation; "seed" summaries must keep object identity
      // (they are read off the same immutable stored events).
      store.appendEvents([makeTaskStartedEvent(3, "other")]);
      const after = store.getTaskStates().get("seed")!;

      expect(after.inputSummary).toBe(before.inputSummary);
      expect(after.outputSummary).toBe(before.outputSummary);
    });
  });
});

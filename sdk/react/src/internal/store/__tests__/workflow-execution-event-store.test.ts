import { describe, it, expect, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  WorkflowExecutionEventSchema,
  WorkflowEventType,
  TaskStartedPayloadSchema,
  TaskCompletedPayloadSchema,
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { WorkflowExecutionEventStore } from "../workflow-execution-event-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTaskStartedEvent(
  seq: number,
  taskName: string,
  opts: { taskKind?: number; attemptNumber?: number } = {},
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
      }),
    },
  });
}

function makeTaskCompletedEvent(
  seq: number,
  taskName: string,
  opts: { durationMs?: bigint; costMicros?: bigint; tokensUsed?: bigint } = {},
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
});

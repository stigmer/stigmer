import { create } from "@bufbuild/protobuf";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
  BudgetCheckpointPayloadSchema,
  ExecutionFailedPayloadSchema,
  TaskFailedPayloadSchema,
  TaskRetryingPayloadSchema,
  WorkflowExecutionEventSchema,
  WorkflowEventType,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { describe, expect, it } from "vitest";
import { toWorkflowEventView, workflowEventTypeName } from "./workflow-event-view.js";

describe("workflowEventTypeName", () => {
  it("returns the canonical proto name for the type", () => {
    expect(workflowEventTypeName(WorkflowEventType.execution_started)).toBe("execution_started");
    expect(workflowEventTypeName(WorkflowEventType.approval_requested)).toBe("approval_requested");
  });
});

describe("toWorkflowEventView", () => {
  it("formats the HH:MM:SS slice of occurred_at", () => {
    const event = create(WorkflowExecutionEventSchema, {
      eventType: WorkflowEventType.execution_started,
      occurredAt: "2026-06-12T13:45:09.123Z",
      payload: { case: "executionStarted", value: {} as never },
    });
    expect(toWorkflowEventView(event).time).toBe("13:45:09");
  });

  it("falls back to dashes when occurred_at is empty", () => {
    const event = create(WorkflowExecutionEventSchema, {
      eventType: WorkflowEventType.execution_started,
      payload: { case: "executionStarted", value: {} as never },
    });
    expect(toWorkflowEventView(event).time).toBe("--------");
  });

  it("marks execution_completed/failed/cancelled/terminated as terminal", () => {
    for (const c of ["executionCompleted", "executionCancelled", "executionTerminated"] as const) {
      const event = create(WorkflowExecutionEventSchema, { payload: { case: c, value: {} as never } });
      expect(toWorkflowEventView(event).terminal).toBe(true);
    }
    const failed = create(WorkflowExecutionEventSchema, {
      payload: { case: "executionFailed", value: create(ExecutionFailedPayloadSchema, { error: "boom" }) },
    });
    const view = toWorkflowEventView(failed);
    expect(view.terminal).toBe(true);
    expect(view.tone).toBe("error");
    expect(view.text).toBe("execution failed: boom");
  });

  it("does not mark task/lifecycle non-terminal events as terminal", () => {
    const event = create(WorkflowExecutionEventSchema, {
      taskName: "validate",
      payload: { case: "taskStarted", value: {} as never },
    });
    const view = toWorkflowEventView(event);
    expect(view.terminal).toBe(false);
    expect(view.text).toBe("task started: validate");
  });

  it("extracts the error and task name for task_failed", () => {
    const event = create(WorkflowExecutionEventSchema, {
      taskName: "send",
      payload: { case: "taskFailed", value: create(TaskFailedPayloadSchema, { error: "timeout" }) },
    });
    expect(toWorkflowEventView(event).text).toBe("task failed: send — timeout");
  });

  it("includes the next attempt for task_retrying", () => {
    const event = create(WorkflowExecutionEventSchema, {
      taskName: "send",
      payload: { case: "taskRetrying", value: create(TaskRetryingPayloadSchema, { nextAttempt: 3 }) },
    });
    expect(toWorkflowEventView(event).text).toBe("task retrying: send (attempt 3)");
  });

  it("renders the prompt for approval_requested", () => {
    const event = create(WorkflowExecutionEventSchema, {
      taskName: "review",
      payload: { case: "approvalRequested", value: create(ApprovalRequestedPayloadSchema, { prompt: "ok?" }) },
    });
    expect(toWorkflowEventView(event).text).toBe("approval requested: review — ok?");
  });

  it("renders the action and resolver for approval_resolved", () => {
    const event = create(WorkflowExecutionEventSchema, {
      taskName: "review",
      payload: {
        case: "approvalResolved",
        value: create(ApprovalResolvedPayloadSchema, { action: ApprovalAction.APPROVE, resolvedBy: "alice" }),
      },
    });
    expect(toWorkflowEventView(event).text).toBe("approval resolved: review — approve by alice");
  });

  it("converts micros to a dollar amount for budget_checkpoint", () => {
    const event = create(WorkflowExecutionEventSchema, {
      payload: { case: "budgetCheckpoint", value: create(BudgetCheckpointPayloadSchema, { costConsumedMicros: 1_234_500n }) },
    });
    expect(toWorkflowEventView(event).text).toBe("budget: $1.2345 spent");
  });

  it("falls back to a generic line for events without a dedicated view", () => {
    const event = create(WorkflowExecutionEventSchema, {
      eventType: WorkflowEventType.signal_received,
      payload: { case: "signalReceived", value: {} as never },
    });
    const view = toWorkflowEventView(event);
    expect(view.glyph).toBe("");
    expect(view.text).toBe("event: signal_received");
  });
});

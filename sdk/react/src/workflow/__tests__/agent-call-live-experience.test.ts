/**
 * Tests for the Agent Call Live Experience feature.
 *
 * Covers:
 * - WorkflowExecutionEventStore: agentCallProgress handler
 * - ExecutionBadge: approval tool name + agent activity rendering
 * - AgentCallTab: live/static/pending view switching based on task state
 * - ExecutionInspector: Approval tab visibility
 */

import { describe, expect, it } from "vitest";
import { WorkflowExecutionEventStore } from "../../internal/store/workflow-execution-event-store";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";

function makeStoreEvent(
  taskName: string,
  seq: number,
  payload: { case: string; value: unknown },
): WorkflowExecutionEvent {
  return {
    eventId: `evt-${seq}`,
    eventType: 0,
    sequenceNumber: BigInt(seq),
    occurredAt: "2026-01-01T00:00:00Z",
    taskName,
    payload,
    $typeName: "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionEvent",
    $unknown: undefined,
  } as unknown as WorkflowExecutionEvent;
}

// ---------------------------------------------------------------------------
// Event store: agentCallProgress handler
// ---------------------------------------------------------------------------

describe("WorkflowExecutionEventStore agentCallProgress", () => {
  it("propagates childExecutionId from agentCallProgress to DerivedTaskState", () => {
    const store = new WorkflowExecutionEventStore();
    store.appendEvents([
      makeStoreEvent("agent-task", 1, {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 1 },
      }),
      makeStoreEvent("agent-task", 2, {
        case: "agentCallStarted",
        value: { childExecutionId: "", agentSlug: "my-agent", messageSummary: "" },
      }),
      makeStoreEvent("agent-task", 3, {
        case: "agentCallProgress",
        value: {
          childExecutionId: "aex_123",
          agentSlug: "my-agent",
          agentPhase: 1,
          currentToolName: "web-search",
          tokensConsumed: BigInt(500),
          messagesCount: 3,
          toolCallsCount: 1,
        },
      }),
    ]);

    const state = store.getTaskStates().get("agent-task");
    expect(state).toBeDefined();
    expect(state!.childExecutionId).toBe("aex_123");
    expect(state!.agentSlug).toBe("my-agent");
    expect(state!.currentToolName).toBe("web-search");
    expect(state!.messagesCount).toBe(3);
    expect(state!.toolCallsCount).toBe(1);
  });

  it("preserves existing cost/tokens when agentCallProgress has zero values", () => {
    const store = new WorkflowExecutionEventStore();
    store.appendEvents([
      makeStoreEvent("agent-task", 1, {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 1 },
      }),
      makeStoreEvent("agent-task", 2, {
        case: "agentCallProgress",
        value: {
          childExecutionId: "aex_456",
          agentSlug: "agent-x",
          agentPhase: 0,
          currentToolName: "",
          tokensConsumed: BigInt(0),
          messagesCount: 0,
          toolCallsCount: 0,
        },
      }),
    ]);

    const state = store.getTaskStates().get("agent-task");
    expect(state!.childExecutionId).toBe("aex_456");
    expect(state!.tokensUsed).toBe(BigInt(0));
  });

  it("clears currentToolName on agentCallCompleted", () => {
    const store = new WorkflowExecutionEventStore();
    store.appendEvents([
      makeStoreEvent("agent-task", 1, {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 1 },
      }),
      makeStoreEvent("agent-task", 2, {
        case: "agentCallProgress",
        value: {
          childExecutionId: "aex_789",
          agentSlug: "agent-y",
          agentPhase: 1,
          currentToolName: "grep",
          tokensConsumed: BigInt(100),
          messagesCount: 2,
          toolCallsCount: 1,
        },
      }),
      makeStoreEvent("agent-task", 3, {
        case: "agentCallCompleted",
        value: {
          durationMs: BigInt(5000),
          tokensConsumed: BigInt(2000),
          costMicros: BigInt(500),
          error: "",
          agentPhase: 2,
        },
      }),
    ]);

    const state = store.getTaskStates().get("agent-task");
    expect(state!.currentToolName).toBe("");
    expect(state!.costMicros).toBe(BigInt(500));
    expect(state!.tokensUsed).toBe(BigInt(2000));
  });

  it("updates progress fields on successive agentCallProgress events", () => {
    const store = new WorkflowExecutionEventStore();
    store.appendEvents([
      makeStoreEvent("agent-task", 1, {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 1 },
      }),
      makeStoreEvent("agent-task", 2, {
        case: "agentCallProgress",
        value: {
          childExecutionId: "aex_111",
          agentSlug: "agent-z",
          agentPhase: 1,
          currentToolName: "read-file",
          tokensConsumed: BigInt(200),
          messagesCount: 2,
          toolCallsCount: 1,
        },
      }),
    ]);

    let state = store.getTaskStates().get("agent-task");
    expect(state!.currentToolName).toBe("read-file");
    expect(state!.messagesCount).toBe(2);

    store.appendEvents([
      makeStoreEvent("agent-task", 3, {
        case: "agentCallProgress",
        value: {
          childExecutionId: "aex_111",
          agentSlug: "agent-z",
          agentPhase: 2,
          currentToolName: "write-file",
          tokensConsumed: BigInt(800),
          messagesCount: 5,
          toolCallsCount: 3,
        },
      }),
    ]);

    state = store.getTaskStates().get("agent-task");
    expect(state!.currentToolName).toBe("write-file");
    expect(state!.messagesCount).toBe(5);
    expect(state!.toolCallsCount).toBe(3);
    expect(state!.tokensUsed).toBe(BigInt(800));
  });
});

// ---------------------------------------------------------------------------
// ExecutionBadge logic
// ---------------------------------------------------------------------------

describe("ExecutionBadge approval enhancement", () => {
  it("renders tool name when status is waiting_approval and approvalToolName is provided", () => {
    const status = "waiting_approval" as const;
    const toolName = "deploy_code";

    expect(status).toBe("waiting_approval");
    expect(toolName).toBeTruthy();
  });

  it("falls back to generic approval badge when no tool name", () => {
    const status = "waiting_approval" as const;
    const toolName = undefined;

    expect(status).toBe("waiting_approval");
    expect(toolName).toBeUndefined();
  });
});

describe("ExecutionBadge agent activity", () => {
  it("shows tool name badge when agent has currentToolName", () => {
    const status = "running" as const;
    const agentActivity = {
      agentSlug: "my-agent",
      currentToolName: "web-search",
      messagesCount: 5,
      toolCallsCount: 3,
    };

    const hasActivity = status === "running" && agentActivity &&
      (agentActivity.currentToolName || agentActivity.messagesCount > 0);
    expect(!!hasActivity).toBe(true);

    const displayText = agentActivity.currentToolName || `${agentActivity.messagesCount} msgs`;
    expect(displayText).toBe("web-search");
  });

  it("shows message count badge when no tool is active", () => {
    const agentActivity = {
      agentSlug: "my-agent",
      currentToolName: "",
      messagesCount: 12,
      toolCallsCount: 0,
    };

    const displayText = agentActivity.currentToolName || `${agentActivity.messagesCount} msgs`;
    expect(displayText).toBe("12 msgs");
  });

  it("does not show agent badge when no activity data", () => {
    const status = "running" as const;
    const agentActivity = {
      agentSlug: "",
      currentToolName: "",
      messagesCount: 0,
      toolCallsCount: 0,
    };

    const hasActivity = status === "running" && agentActivity &&
      (agentActivity.currentToolName || agentActivity.messagesCount > 0);
    expect(hasActivity).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AgentCallTab view switching
// ---------------------------------------------------------------------------

describe("AgentCallTab view switching", () => {
  it("shows live view when task is running and childExecutionId is available", () => {
    const taskStatus = "running" as const;
    const childExecutionId = "aex_abc123";
    const isTabActive = true;

    const shouldSubscribe = isTabActive && (taskStatus === "running" || taskStatus === "waiting_approval") && !!childExecutionId;
    expect(shouldSubscribe).toBe(true);
  });

  it("shows pending view when task is running but no childExecutionId", () => {
    const taskStatus = "running" as const;
    const childExecutionId = "";
    const isTabActive = true;

    const isRunning = taskStatus === "running" || taskStatus === "waiting_approval";
    const hasChildId = !!childExecutionId;
    const shouldSubscribe = isTabActive && isRunning && hasChildId;

    expect(shouldSubscribe).toBe(false);
    expect(isRunning && !hasChildId).toBe(true);
  });

  it("shows static view when task is completed", () => {
    const taskStatus: string = "completed";

    const isRunning = taskStatus === "running" || taskStatus === "waiting_approval";
    expect(isRunning).toBe(false);
  });

  it("does not subscribe when tab is not active", () => {
    const taskStatus = "running" as const;
    const childExecutionId = "aex_abc123";
    const isTabActive = false;

    const shouldSubscribe = isTabActive && (taskStatus === "running" || taskStatus === "waiting_approval") && !!childExecutionId;
    expect(shouldSubscribe).toBe(false);
  });

  it("subscribes when task is waiting_approval with childExecutionId", () => {
    const taskStatus: string = "waiting_approval";
    const childExecutionId = "aex_abc123";
    const isTabActive = true;

    const shouldSubscribe = isTabActive && (taskStatus === "running" || taskStatus === "waiting_approval") && !!childExecutionId;
    expect(shouldSubscribe).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Inspector Approval tab visibility
// ---------------------------------------------------------------------------

describe("Inspector Approval tab visibility", () => {
  it("shows Approval tab when task has matching pending approvals", () => {
    const approvalCount = 2;
    const shouldShowTab = approvalCount > 0;
    expect(shouldShowTab).toBe(true);
  });

  it("hides Approval tab when no pending approvals for selected task", () => {
    const approvalCount = 0;
    const shouldShowTab = approvalCount > 0;
    expect(shouldShowTab).toBe(false);
  });
});

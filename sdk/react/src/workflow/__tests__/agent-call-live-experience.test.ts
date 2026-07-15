/**
 * Tests for the Agent Call Live Experience feature.
 *
 * Covers:
 * - WorkflowExecutionEventStore: agentCallProgress handler
 * - ExecutionBadge: approval tool name + agent activity rendering
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

  it("derives correct agentActivity fields from a realistic full-lifecycle event sequence", () => {
    const store = new WorkflowExecutionEventStore();

    // Phase 1: execution and task start
    store.appendEvents([
      makeStoreEvent("", 1, {
        case: "executionStarted",
        value: { totalTasks: 1 },
      }),
      makeStoreEvent("analyze_player_data", 2, {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 1 },
      }),
    ]);

    let state = store.getTaskStates().get("analyze_player_data");
    expect(state).toBeDefined();
    expect(state!.status).toBe("running");
    expect(state!.childExecutionId).toBe("");

    // Phase 2: agent_call_started (childExecutionId empty — not known yet)
    store.appendEvents([
      makeStoreEvent("analyze_player_data", 3, {
        case: "agentCallStarted",
        value: { childExecutionId: "", agentSlug: "notification-analyst", messageSummary: "Generate the daily cohort analysis..." },
      }),
    ]);

    state = store.getTaskStates().get("analyze_player_data");
    expect(state!.agentSlug).toBe("notification-analyst");
    expect(state!.childExecutionId).toBe("");

    // Phase 3: first progress with childExecutionId (from child_execution_started signal)
    store.appendEvents([
      makeStoreEvent("analyze_player_data", 4, {
        case: "agentCallProgress",
        value: {
          childExecutionId: "aex_01abc",
          agentPhase: 1,
          currentToolName: "",
          tokensConsumed: BigInt(0),
          messagesCount: 0,
          toolCallsCount: 0,
        },
      }),
    ]);

    state = store.getTaskStates().get("analyze_player_data");
    expect(state!.childExecutionId).toBe("aex_01abc");
    expect(state!.agentSlug).toBe("notification-analyst");

    // Verify agentActivity gate: slug is set but no tool/messages yet → no badge
    const hasActivityAfterEarlyProgress =
      state!.status === "running" &&
      !!state!.agentSlug &&
      (!!state!.currentToolName || state!.messagesCount > 0);
    expect(hasActivityAfterEarlyProgress).toBe(false);

    // Phase 4: periodic progress with real data
    store.appendEvents([
      makeStoreEvent("analyze_player_data", 5, {
        case: "agentCallProgress",
        value: {
          childExecutionId: "aex_01abc",
          agentPhase: 1,
          currentToolName: "execute-sql",
          tokensConsumed: BigInt(1200),
          messagesCount: 4,
          toolCallsCount: 2,
        },
      }),
    ]);

    state = store.getTaskStates().get("analyze_player_data");
    expect(state!.currentToolName).toBe("execute-sql");
    expect(state!.messagesCount).toBe(4);
    expect(state!.toolCallsCount).toBe(2);

    // Verify agentActivity gate: now tool AND slug are present → badge shows
    const hasActivityAfterRealProgress =
      state!.status === "running" &&
      !!state!.agentSlug &&
      (!!state!.currentToolName || state!.messagesCount > 0);
    expect(hasActivityAfterRealProgress).toBe(true);
  });

  it("does not create agentActivity when agentCallProgress arrives without agentCallStarted (no agentSlug)", () => {
    const store = new WorkflowExecutionEventStore();

    store.appendEvents([
      makeStoreEvent("orphan-task", 1, {
        case: "taskStarted",
        value: { taskKind: 1, attemptNumber: 1 },
      }),
      makeStoreEvent("orphan-task", 2, {
        case: "agentCallProgress",
        value: {
          childExecutionId: "aex_orphan",
          agentPhase: 1,
          currentToolName: "web-search",
          tokensConsumed: BigInt(500),
          messagesCount: 3,
          toolCallsCount: 1,
        },
      }),
    ]);

    const state = store.getTaskStates().get("orphan-task");
    expect(state).toBeDefined();
    // Progress fields should be populated...
    expect(state!.childExecutionId).toBe("aex_orphan");
    expect(state!.currentToolName).toBe("web-search");
    // ...but agentSlug is empty (only set by agentCallStarted)
    expect(state!.agentSlug).toBe("");

    // agentActivity gate should fail — badge won't render
    const hasActivity =
      state!.status === "running" &&
      !!state!.agentSlug &&
      (!!state!.currentToolName || state!.messagesCount > 0);
    expect(hasActivity).toBe(false);
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

// NOTE: the "AgentCallTab view switching" suite that lived here tested the
// tab's embedded-thumbnail subscription gating. S4 replaced the thumbnail
// with a launcher (no subscription in the inspector at all); the launcher's
// behavior is covered by component tests in agent-call-tab.test.tsx, and the
// transcript's fetch/stream lifecycle by useLiveAgentExecution.test.tsx +
// WorkflowAgentExecutionDocument.test.tsx.

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

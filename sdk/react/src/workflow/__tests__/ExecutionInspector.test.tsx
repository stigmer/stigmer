import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionInspector } from "../execution-inspector";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";

function makeEvent(
  taskName: string,
  seq: number,
  payload: { case: string; value: unknown },
): WorkflowExecutionEvent {
  return {
    eventId: `evt-${seq}`,
    eventType: 0,
    sequenceNumber: BigInt(seq),
    occurredAt: "2026-06-02T07:40:08Z",
    taskName,
    payload,
    $typeName: "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionEvent",
    $unknown: undefined,
  } as unknown as WorkflowExecutionEvent;
}

function makeTaskState(
  taskName: string,
  status: DerivedTaskState["status"],
): DerivedTaskState {
  return {
    taskName,
    taskKind: 0 as DerivedTaskState["taskKind"],
    status,
    durationMs: 0,
    costMicros: BigInt(0),
    tokensUsed: BigInt(0),
    attemptNumber: 1,
    error: "",
    childExecutionId: "",
    agentSlug: "",
    currentToolName: "",
    messagesCount: 0,
    toolCallsCount: 0,
  };
}

function makeSnapshot(taskName: string, output: Record<string, unknown>): WorkflowTask {
  return {
    taskId: `${taskName}:1`,
    taskName,
    taskType: 0,
    status: 0,
    startedAt: "2026-06-02T07:40:08Z",
    completedAt: "2026-06-02T07:41:08Z",
    error: "",
    artifactIds: [],
    costMicros: BigInt(0),
    inputTokens: BigInt(0),
    outputTokens: BigInt(0),
    output,
    $typeName: "ai.stigmer.agentic.workflowexecution.v1.WorkflowTask",
    $unknown: undefined,
  } as unknown as WorkflowTask;
}

const TASK = "team_lead_review";

const approvalRequested = makeEvent(TASK, 1, {
  case: "approvalRequested",
  value: {
    prompt: "Review today's plan.",
    approvers: [],
    timeoutSeconds: 0,
    outcomes: [
      { name: "approve", label: "Approve Plan" },
      { name: "reject", label: "Reject" },
    ],
    formSchema: null,
  },
});

describe("ExecutionInspector — approval gating", () => {
  afterEach(cleanup);

  it("renders the interactive approval card while the gate is waiting", () => {
    render(
      <ExecutionInspector
        selectedTaskName={TASK}
        events={[approvalRequested]}
        taskStates={new Map([[TASK, makeTaskState(TASK, "waiting_approval")]])}
        onSubmitTaskApproval={vi.fn().mockResolvedValue(undefined)}
        isSubmittingTaskApproval={false}
      />,
    );

    // Interactive: outcome buttons are actionable.
    expect(screen.getByRole("button", { name: "Approve Plan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
  });

  it("renders the read-only decision summary once the gate is resolved", () => {
    render(
      <ExecutionInspector
        selectedTaskName={TASK}
        events={[approvalRequested]}
        taskStates={new Map([[TASK, makeTaskState(TASK, "completed")]])}
        taskSnapshots={[
          makeSnapshot(TASK, {
            outcome: "approve",
            reviewer: "alice",
            comment: "ship it",
          }),
        ]}
        onSubmitTaskApproval={vi.fn().mockResolvedValue(undefined)}
        isSubmittingTaskApproval={false}
      />,
    );

    // A resolved (completed) task auto-opens the Summary tab; switch to Approval.
    fireEvent.click(screen.getByRole("tab", { name: /Approval/ }));

    // Read-only: the captured outcome and comment are shown, no decision buttons.
    expect(screen.getByText("Approve Plan")).toBeTruthy();
    expect(screen.getByText("ship it")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve Plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });
});

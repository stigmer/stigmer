import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type {
  WorkflowTask,
  WorkflowPendingFileReview,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  WorkflowPendingApprovalSchema,
  WorkflowPendingFileReviewSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ExecutionInspector } from "../execution-inspector";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";

// The file-review list streams each referenced child (StigmerProvider
// territory — its own suite covers the real rendering); this suite proves
// the inspector's seam: tab visibility, per-task filtering, and wiring.
vi.mock("../WorkflowFileReviewList", () => ({
  WorkflowFileReviewList: ({
    pendingFileReviews,
  }: {
    pendingFileReviews: readonly WorkflowPendingFileReview[];
  }) => (
    <div data-testid="file-review-list-stub">
      {pendingFileReviews.map((r) => r.childAgentExecutionId).join(",")}
    </div>
  ),
}));

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
    inputSummary: null,
    outputSummary: null,
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
      />,
    );

    // Interactive: outcome buttons are actionable.
    expect(screen.getByRole("button", { name: "Approve Plan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
  });

  it("surfaces this gate's keyed failure in-card, beside the outcome buttons", () => {
    render(
      <ExecutionInspector
        selectedTaskName={TASK}
        events={[approvalRequested]}
        taskStates={new Map([[TASK, makeTaskState(TASK, "waiting_approval")]])}
        onSubmitTaskApproval={vi.fn().mockResolvedValue(undefined)}
        taskApprovalErrorsByTaskName={new Map([[TASK, new Error("signal failed")]])}
      />,
    );

    expect(screen.getByText(/Couldn.t submit decision — signal failed/)).toBeTruthy();
  });

  it("marks only this gate's buttons as submitting via the keyed set", () => {
    render(
      <ExecutionInspector
        selectedTaskName={TASK}
        events={[approvalRequested]}
        taskStates={new Map([[TASK, makeTaskState(TASK, "waiting_approval")]])}
        onSubmitTaskApproval={vi.fn().mockResolvedValue(undefined)}
        taskApprovalSubmittingTaskNames={new Set([TASK])}
      />,
    );

    expect(
      (screen.getByRole("button", { name: "Approve Plan" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("renders the shared 4-action ApprovalCard for a forwarded child tool approval", () => {
    // An AGENT_CALL task whose child hit a tool gate: the Approval tab must
    // render the session's canonical ApprovalCard (via WorkflowApprovalList)
    // — same actions, preview, and provenance as everywhere else the gate
    // appears — routed through the WORKFLOW-level submit handler.
    const AGENT_TASK = "call_helper";
    const agentCallStarted = makeEvent(AGENT_TASK, 1, {
      case: "agentCallStarted",
      value: {
        childExecutionId: "agx_child",
        agentSlug: "helper",
        messageSummary: "",
      },
    });
    const onSubmitApproval = vi.fn().mockResolvedValue(undefined);

    render(
      <ExecutionInspector
        selectedTaskName={AGENT_TASK}
        events={[agentCallStarted]}
        taskStates={new Map([[AGENT_TASK, makeTaskState(AGENT_TASK, "waiting_approval")]])}
        pendingApprovals={[
          create(WorkflowPendingApprovalSchema, {
            childAgentExecutionId: "agx_child",
            approval: create(PendingApprovalSchema, {
              toolCallId: "tc_inspector",
              toolName: "delete_file",
              argsPreview: '{"path":"/tmp/x"}',
            }),
          }),
        ]}
        onSubmitApproval={onSubmitApproval}
      />,
    );

    // The shared card, with the full 4-action decision model.
    expect(
      screen.getByRole("alert", { name: "Approval required for delete_file" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Approve all file deletions" }),
    ).toBeTruthy();
    // No per-gate nav link here: the tab is already scoped to the selected
    // task's child, and the Agent tab owns navigation.
    expect(
      screen.queryByRole("button", { name: "View agent execution" }),
    ).toBeNull();

    // Decisions carry the gate's toolCallId to the workflow-level handler.
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onSubmitApproval).toHaveBeenCalledWith(
      "tc_inspector",
      ApprovalAction.SKIP,
      undefined,
    );
  });

  it("shows the Approval tab for a file-review-only gate, scoped to the selected task's child (S9)", () => {
    // No tool approvals and no human_input gate — pending file reviews alone
    // must surface the Approval tab (they became Inspect's responsibility
    // when the bottom drawer was retired).
    const AGENT_TASK = "call_helper";
    const agentCallStarted = makeEvent(AGENT_TASK, 1, {
      case: "agentCallStarted",
      value: {
        childExecutionId: "agx_child",
        agentSlug: "helper",
        messageSummary: "",
      },
    });

    render(
      <ExecutionInspector
        selectedTaskName={AGENT_TASK}
        events={[agentCallStarted]}
        taskStates={new Map([[AGENT_TASK, makeTaskState(AGENT_TASK, "waiting_approval")]])}
        pendingFileReviews={[
          create(WorkflowPendingFileReviewSchema, {
            childAgentExecutionId: "agx_child",
            changeSetId: ["cs_1"],
          }),
          // A sibling child's review — must be filtered OUT of this task.
          create(WorkflowPendingFileReviewSchema, {
            childAgentExecutionId: "agx_other",
            changeSetId: ["cs_2"],
          }),
        ]}
        onSubmitFileDecision={vi.fn()}
      />,
    );

    // The gate auto-opens the Approval tab (waiting_approval status) with a
    // badge counting only this task's gates.
    expect(
      screen.getByRole("tab", { name: /Approval/, selected: true }),
    ).toBeTruthy();
    expect(screen.getByTestId("file-review-list-stub").textContent).toBe(
      "agx_child",
    );
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

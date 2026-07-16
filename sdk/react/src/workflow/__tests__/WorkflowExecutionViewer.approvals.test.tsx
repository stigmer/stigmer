// Composition test for the execution-level HITL surface after the bottom
// drawer's retirement (S9): a gate arriving on the live stream auto-selects
// its task, the panel's Inspect facet renders the gate through the shared
// session ApprovalCard (via WorkflowApprovalList), file reviews ride the
// same tab through WorkflowFileReviewList, and every decision routes through
// the single useWorkflowExecutionActions instance. Data hooks and heavy
// leaves (React Flow graph) are mocked exactly as in the reconciliation
// harness; this file proves the seam.
//
// GUARDRAIL (S5 rationale): the entire render runs WITHOUT a StigmerProvider.
// Any component reaching for a client hook (the child's agentExecution.*
// submit path) would throw — so a passing render plus the workflow actions
// spy receiving the decision proves gates route through the WORKFLOW-level
// RPC only. (WorkflowFileReviewList streams its child itself and therefore
// NEEDS the provider — it is stubbed at the module seam here; its own suite
// covers the real child-derived rendering.)

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { WorkflowPendingApproval, WorkflowPendingFileReview } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  ExecutionPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type {
  DerivedCostSummary,
  DerivedTaskState,
} from "../../internal/store/workflow-execution-event-store";
import { useWorkflowExecution } from "../useWorkflowExecution";
import { useWorkflowExecutionEventStream } from "../useWorkflowExecutionEventStream";
import { useWorkflowExecutionArtifacts } from "../useWorkflowExecutionArtifacts";
import { useWorkflowExecutionFileChanges } from "../useWorkflowExecutionFileChanges";
import { useWorkflowExecutionActions } from "../useWorkflowExecutionActions";
import type { WorkflowFileDecisionSubmit } from "../WorkflowFileReviewList";
import { WorkflowExecutionViewer } from "../WorkflowExecutionViewer";

vi.mock("../useWorkflowExecution", () => ({
  useWorkflowExecution: vi.fn(),
}));
vi.mock("../useWorkflowExecutionEventStream", () => ({
  useWorkflowExecutionEventStream: vi.fn(),
}));
vi.mock("../useWorkflowExecutionArtifacts", () => ({
  useWorkflowExecutionArtifacts: vi.fn(),
}));
vi.mock("../useWorkflowExecutionFileChanges", () => ({
  useWorkflowExecutionFileChanges: vi.fn(),
}));
vi.mock("../useWorkflowExecutionActions", () => ({
  useWorkflowExecutionActions: vi.fn(),
}));

vi.mock("../WorkflowExecutionGraph", () => ({
  WorkflowExecutionGraph: () => <div data-testid="graph-stub" />,
}));
vi.mock("../execution-comparison/ExecutionComparisonPicker", () => ({
  ExecutionComparisonPicker: () => null,
}));

// Streams its child (needs the provider this guardrail render deliberately
// omits) — stubbed to prove the seam: the Inspect Approval tab hands it the
// task-scoped references and the workflow-level decision submit.
vi.mock("../WorkflowFileReviewList", () => ({
  WorkflowFileReviewList: ({
    pendingFileReviews,
    onSubmitFileDecision,
  }: {
    pendingFileReviews: readonly WorkflowPendingFileReview[];
    onSubmitFileDecision: WorkflowFileDecisionSubmit;
  }) => (
    <div data-testid="file-review-list-stub">
      {pendingFileReviews.map((ref) => (
        <button
          key={ref.childAgentExecutionId}
          type="button"
          onClick={() =>
            onSubmitFileDecision(
              ref.childAgentExecutionId,
              ref.changeSetId[0] ?? "",
              1 as never,
            )
          }
        >
          decide-files-{ref.childAgentExecutionId}
        </button>
      ))}
    </div>
  ),
}));

const mockedUseWorkflowExecution = vi.mocked(useWorkflowExecution);
const mockedUseEventStream = vi.mocked(useWorkflowExecutionEventStream);
const mockedUseArtifacts = vi.mocked(useWorkflowExecutionArtifacts);
const mockedUseFileChanges = vi.mocked(useWorkflowExecutionFileChanges);
const mockedUseActions = vi.mocked(useWorkflowExecutionActions);

const COST_SUMMARY: DerivedCostSummary = {
  costConsumedMicros: 0n,
  costRemainingMicros: -1n,
  tokensConsumed: 0n,
  tokensRemaining: -1n,
  thresholdBreached: false,
};

/** A waiting AGENT_CALL task bound to its child execution. */
function gatedTask(name: string, childId: string): DerivedTaskState {
  return {
    taskName: name,
    taskKind: WorkflowTaskKind.agent_call,
    status: "waiting_approval",
    durationMs: 0,
    costMicros: 0n,
    tokensUsed: 0n,
    attemptNumber: 1,
    error: "",
    childExecutionId: childId,
    agentSlug: "helper",
    currentToolName: "",
    messagesCount: 0,
    toolCallsCount: 0,
  } as DerivedTaskState;
}

/**
 * Two parallel AGENT_CALL tasks, each waiting on its own child's gates. The
 * task snapshots carry `agent_execution_id` metadata — the inspector's
 * event-less path for resolving the AGENT_CALL child (and therefore the
 * per-task gate filter).
 */
function makeExecutionWithGates(overrides?: {
  pendingApprovals?: unknown[];
  pendingFileReviews?: unknown[];
}) {
  return create(WorkflowExecutionSchema, {
    metadata: { id: "wex_1", name: "nightly-report" },
    spec: { workflowId: "wf_1" },
    status: {
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      startedAt: "2026-07-15T00:00:00Z",
      tasks: [
        {
          taskName: "call-helper-a",
          status: WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL,
          startedAt: "2026-07-15T00:00:00Z",
          metadata: { agent_execution_id: "agx_child_a" },
        },
        {
          taskName: "call-helper-b",
          status: WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL,
          startedAt: "2026-07-15T00:00:01Z",
          metadata: { agent_execution_id: "agx_child_b" },
        },
      ],
      pendingApprovals: (overrides?.pendingApprovals ?? [
        {
          childAgentExecutionId: "agx_child_a",
          approval: {
            toolCallId: "tc_delete",
            toolName: "delete_file",
            argsPreview: '{"path":"/tmp/x"}',
          },
        },
        {
          childAgentExecutionId: "agx_child_b",
          approval: {
            toolCallId: "tc_shell",
            toolName: "shell",
            argsPreview: '{"command":"npm test"}',
          },
        },
      ]) as WorkflowPendingApproval[],
      pendingFileReviews: (overrides?.pendingFileReviews ??
        []) as WorkflowPendingFileReview[],
    },
  });
}

function mockActions(overrides?: {
  submitApproval?: ReturnType<typeof vi.fn>;
  submitFileDecision?: ReturnType<typeof vi.fn>;
  approvalSubmittingToolCallIds?: ReadonlySet<string>;
  approvalErrorsByToolCallId?: ReadonlyMap<string, Error>;
}) {
  return {
    cancel: vi.fn(),
    terminate: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    recover: vi.fn(),
    submitApproval: overrides?.submitApproval ?? vi.fn(),
    submitTaskApproval: vi.fn(),
    submitFileDecision: overrides?.submitFileDecision ?? vi.fn(),
    isSubmitting: false,
    error: null,
    clearError: vi.fn(),
    approvalSubmittingToolCallIds:
      overrides?.approvalSubmittingToolCallIds ?? new Set<string>(),
    approvalErrorsByToolCallId:
      overrides?.approvalErrorsByToolCallId ?? new Map<string, Error>(),
    taskApprovalSubmittingTaskNames: new Set<string>(),
    taskApprovalErrorsByTaskName: new Map<string, Error>(),
    fileDecisionSubmittingKeys: new Set<string>(),
    fileDecisionErrorsByKey: new Map<string, Error>(),
  } as unknown as ReturnType<typeof useWorkflowExecutionActions>;
}

function arrange(
  actions = mockActions(),
  executionOverrides?: Parameters<typeof makeExecutionWithGates>[0],
) {
  mockedUseWorkflowExecution.mockReturnValue({
    execution: makeExecutionWithGates(executionOverrides),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useWorkflowExecution>);
  mockedUseEventStream.mockReturnValue({
    events: [],
    taskStates: new Map([
      ["call-helper-a", gatedTask("call-helper-a", "agx_child_a")],
      ["call-helper-b", gatedTask("call-helper-b", "agx_child_b")],
    ]),
    costSummary: COST_SUMMARY,
    streamState: { stage: "streaming" },
    totalTasks: 2,
    error: null,
    reconnect: vi.fn(),
  } as unknown as ReturnType<typeof useWorkflowExecutionEventStream>);
  mockedUseArtifacts.mockReturnValue({
    artifacts: [],
  } as unknown as ReturnType<typeof useWorkflowExecutionArtifacts>);
  mockedUseFileChanges.mockReturnValue({
    fileChanges: [],
    fileChangeCount: 0,
    isLoading: false,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  });
  mockedUseActions.mockReturnValue(actions);
  return actions;
}

/** Select a task the way a user would — its thread card. */
function selectThreadCard(taskName: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${taskName}`) }));
}

describe("WorkflowExecutionViewer Inspect-facet HITL (post-drawer, S9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });
  afterEach(cleanup);

  it("gates auto-open the Inspect Approval tab rendering the shared 4-action ApprovalCard, per-task scoped", () => {
    arrange();
    render(<WorkflowExecutionViewer executionId="wex_1" />);

    // Both tasks crossed into waiting_approval at mount; the LAST one wins
    // the auto-selection, and the inspector lands on its Approval tab.
    expect(
      screen.getByRole("tab", { name: /Approval/, selected: true }),
    ).toBeTruthy();
    const shellCard = screen.getByRole("alert", {
      name: "Approval required for shell",
    });
    // The full decision model — including the class-scoped lease — of the
    // shared session card.
    expect(within(shellCard).getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(within(shellCard).getByRole("button", { name: "Skip" })).toBeTruthy();
    expect(within(shellCard).getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(
      within(shellCard).getByRole("button", { name: "Approve all shell commands" }),
    ).toBeTruthy();
    // The rich preview the retired thin card never had.
    expect(shellCard.textContent).toContain("npm test");

    // Per-task scoping: the sibling child's gate is NOT on this surface.
    expect(
      screen.queryByRole("alert", { name: "Approval required for delete_file" }),
    ).toBeNull();

    // Selecting the sibling task swaps the surface to ITS gate.
    selectThreadCard("call-helper-a");
    const deleteCard = screen.getByRole("alert", {
      name: "Approval required for delete_file",
    });
    expect(
      within(deleteCard).getByRole("button", { name: "Approve all file deletions" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("alert", { name: "Approval required for shell" }),
    ).toBeNull();
  });

  it("routes every decision through the workflow-level actions instance with the gate's toolCallId", () => {
    const submitApproval = vi.fn();
    arrange(mockActions({ submitApproval }));
    render(<WorkflowExecutionViewer executionId="wex_1" />);

    // Auto-selected call-helper-b → the shell gate.
    const shellCard = screen.getByRole("alert", {
      name: "Approval required for shell",
    });
    fireEvent.click(
      within(shellCard).getByRole("button", { name: "Approve all shell commands" }),
    );

    selectThreadCard("call-helper-a");
    const deleteCard = screen.getByRole("alert", {
      name: "Approval required for delete_file",
    });
    fireEvent.click(within(deleteCard).getByRole("button", { name: "Reject" }));

    expect(submitApproval).toHaveBeenNthCalledWith(1, "tc_shell", ApprovalAction.APPROVE_ALL, undefined);
    expect(submitApproval).toHaveBeenNthCalledWith(2, "tc_delete", ApprovalAction.REJECT, undefined);
  });

  it("keeps in-flight and error state per gate: one gate's failure never leaks to its sibling or the banner", () => {
    // Both gates on ONE child so both cards share the surface.
    arrange(
      mockActions({
        approvalSubmittingToolCallIds: new Set(["tc_shell"]),
        approvalErrorsByToolCallId: new Map([
          ["tc_delete", new Error("gate already resolved")],
        ]),
      }),
      {
        pendingApprovals: [
          {
            childAgentExecutionId: "agx_child_b",
            approval: {
              toolCallId: "tc_delete",
              toolName: "delete_file",
              argsPreview: '{"path":"/tmp/x"}',
            },
          },
          {
            childAgentExecutionId: "agx_child_b",
            approval: {
              toolCallId: "tc_shell",
              toolName: "shell",
              argsPreview: '{"command":"npm test"}',
            },
          },
        ],
      },
    );
    const { container } = render(<WorkflowExecutionViewer executionId="wex_1" />);

    // In-flight: only the shell gate's actions are disabled.
    const shellCard = screen.getByRole("alert", { name: "Approval required for shell" });
    const deleteCard = screen.getByRole("alert", { name: "Approval required for delete_file" });
    expect(
      (within(shellCard).getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (within(deleteCard).getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled,
    ).toBe(false);

    // Error: in-card on the failing gate only — never the lifecycle banner
    // (actions.error is null, so no banner exists at all).
    const errors = container.querySelectorAll('[data-cursor-target="approval-error"]');
    expect(errors).toHaveLength(1);
    expect(deleteCard.contains(errors[0]!)).toBe(true);
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("file reviews ride the same Approval tab, task-scoped, wired to the workflow-level submit", () => {
    const submitFileDecision = vi.fn();
    arrange(mockActions({ submitFileDecision }), {
      pendingApprovals: [],
      pendingFileReviews: [
        { childAgentExecutionId: "agx_child_a", changeSetId: ["cs_1"] },
        { childAgentExecutionId: "agx_child_b", changeSetId: ["cs_2"] },
      ],
    });
    render(<WorkflowExecutionViewer executionId="wex_1" />);

    // Auto-selected call-helper-b → only ITS child's review reference.
    const list = screen.getByTestId("file-review-list-stub");
    expect(within(list).getByText("decide-files-agx_child_b")).toBeTruthy();
    expect(within(list).queryByText("decide-files-agx_child_a")).toBeNull();

    // Decisions forward to the single actions instance (workflow RPC).
    fireEvent.click(within(list).getByText("decide-files-agx_child_b"));
    expect(submitFileDecision).toHaveBeenCalledWith("agx_child_b", "cs_2", 1);
  });
});

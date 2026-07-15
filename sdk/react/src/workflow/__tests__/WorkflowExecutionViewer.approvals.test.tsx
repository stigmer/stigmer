// Composition test for the bottom "Approvals" tab: the viewer's real wiring
// from `status.pending_approvals` through WorkflowApprovalList to the shared
// session ApprovalCard, with decisions routed through the single
// useWorkflowExecutionActions instance (mocked here — its unit suite covers
// the RPC). Data hooks and heavy leaves (React Flow graph, waterfall) are
// mocked exactly as in the reconciliation harness; this file proves the seam.
//
// GUARDRAIL (S5 rationale): the entire render runs WITHOUT a StigmerProvider.
// Any component reaching for a client hook (the child's agentExecution.*
// submit path) would throw — so a passing render plus the workflow actions
// spy receiving the decision proves gates route through the WORKFLOW-level
// RPC only.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  ExecutionPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
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
vi.mock("../waterfall/index.js", () => ({
  WaterfallTimeline: () => <div data-testid="waterfall-stub" />,
}));
vi.mock("../execution-comparison/ExecutionComparisonPicker", () => ({
  ExecutionComparisonPicker: () => null,
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

function taskState(name: string): DerivedTaskState {
  return {
    taskName: name,
    taskKind: 0,
    status: "waiting_approval",
    durationMs: 0,
    costMicros: 0n,
    tokensUsed: 0n,
    attemptNumber: 1,
    error: "",
    childExecutionId: "agx_child",
    agentSlug: "helper",
    currentToolName: "",
    messagesCount: 0,
    toolCallsCount: 0,
  } as DerivedTaskState;
}

/** Two concurrent gates from parallel children — the isolation scenario. */
function makeExecutionWithGates() {
  return create(WorkflowExecutionSchema, {
    metadata: { id: "wex_1", name: "nightly-report" },
    spec: { workflowId: "wf_1" },
    status: {
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      startedAt: "2026-07-15T00:00:00Z",
      tasks: [
        {
          taskName: "call-helper",
          status: WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL,
          startedAt: "2026-07-15T00:00:00Z",
        },
      ],
      pendingApprovals: [
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
      ],
    },
  });
}

function mockActions(overrides?: {
  submitApproval?: ReturnType<typeof vi.fn>;
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
    submitFileDecision: vi.fn(),
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

function arrange(actions = mockActions()) {
  mockedUseWorkflowExecution.mockReturnValue({
    execution: makeExecutionWithGates(),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useWorkflowExecution>);
  mockedUseEventStream.mockReturnValue({
    events: [],
    taskStates: new Map([["call-helper", taskState("call-helper")]]),
    costSummary: COST_SUMMARY,
    streamState: { stage: "streaming" },
    totalTasks: 1,
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

describe("WorkflowExecutionViewer bottom Approvals tab (shared-card parity)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("auto-opens the Approvals tab and renders each gate as the shared 4-action ApprovalCard", () => {
    arrange();
    render(<WorkflowExecutionViewer executionId="wex_1" />);

    // Both HITL gates count into the one tab; new gates auto-focus it.
    expect(screen.getByRole("button", { name: "Approvals (2)" })).toBeTruthy();

    const deleteCard = screen.getByRole("alert", {
      name: "Approval required for delete_file",
    });
    // The full decision model — including the class-scoped lease — not the
    // retired 2-action card.
    expect(within(deleteCard).getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(within(deleteCard).getByRole("button", { name: "Skip" })).toBeTruthy();
    expect(within(deleteCard).getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(
      within(deleteCard).getByRole("button", { name: "Approve all file deletions" }),
    ).toBeTruthy();

    // The rich preview the thin card never had: the shell gate's command.
    const shellCard = screen.getByRole("alert", {
      name: "Approval required for shell",
    });
    expect(shellCard.textContent).toContain("npm test");
  });

  it("routes every decision through the workflow-level actions instance with the gate's toolCallId", () => {
    const submitApproval = vi.fn();
    arrange(mockActions({ submitApproval }));
    render(<WorkflowExecutionViewer executionId="wex_1" />);

    const deleteCard = screen.getByRole("alert", {
      name: "Approval required for delete_file",
    });
    const shellCard = screen.getByRole("alert", {
      name: "Approval required for shell",
    });

    fireEvent.click(within(deleteCard).getByRole("button", { name: "Reject" }));
    fireEvent.click(within(shellCard).getByRole("button", { name: "Approve all shell commands" }));

    expect(submitApproval).toHaveBeenNthCalledWith(1, "tc_delete", ApprovalAction.REJECT, undefined);
    expect(submitApproval).toHaveBeenNthCalledWith(2, "tc_shell", ApprovalAction.APPROVE_ALL, undefined);
  });

  it("keeps in-flight and error state per gate: one gate's failure never leaks to its sibling or the banner", () => {
    arrange(
      mockActions({
        approvalSubmittingToolCallIds: new Set(["tc_shell"]),
        approvalErrorsByToolCallId: new Map([
          ["tc_delete", new Error("gate already resolved")],
        ]),
      }),
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
});

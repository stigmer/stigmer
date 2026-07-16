// Composition test for the execution-level HITL surfaces after the
// thread-primary pivot completed (S10): gating task cards carry their child
// gates inline in the default Thread view (through the shared session
// ApprovalCard via WorkflowApprovalList), the panel's Inspect Approval tab
// remains the panel-side surface (S9), and every decision routes through the
// single useWorkflowExecutionActions instance. Data hooks and heavy leaves
// (React Flow graph) are mocked exactly as in the reconciliation harness;
// this file proves the seams.
//
// REALISTIC FIXTURES (a hard S10 requirement): the gated task states are
// produced by the REAL store derivation from REAL event shapes — an
// agent_call_progress event carrying the child's WAITING_FOR_APPROVAL phase
// (D-T02-14). S9's hand-crafted `waiting_approval` states masked that
// production never emitted them for child gates; deriving through the store
// keeps these tests honest about the production path.
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
import {
  WorkflowExecutionEventSchema,
  WorkflowEventType,
  TaskStartedPayloadSchema,
  AgentCallStartedPayloadSchema,
  AgentCallProgressPayloadSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import {
  ApprovalAction,
  ExecutionPhase as AgentExecutionPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { DerivedCostSummary } from "../../internal/store/workflow-execution-event-store";
import { WorkflowExecutionEventStore } from "../../internal/store/workflow-execution-event-store";
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
// omits) — stubbed to prove the seam: both the gating card and the Inspect
// Approval tab hand it the task-scoped references and the workflow-level
// decision submit.
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

// ---------------------------------------------------------------------------
// Realistic gated fixtures — REAL events through the REAL store derivation
// ---------------------------------------------------------------------------

function storeEvent(
  seq: number,
  taskName: string,
  eventType: WorkflowEventType,
  payload: WorkflowExecutionEvent["payload"],
): WorkflowExecutionEvent {
  return create(WorkflowExecutionEventSchema, {
    eventId: `evt-${seq}`,
    sequenceNumber: BigInt(seq),
    occurredAt: "2026-07-16T00:00:00Z",
    taskName,
    eventType,
    payload,
  });
}

/**
 * Two parallel AGENT_CALL tasks, both gated by their children: the exact
 * production event sequence — task_started, agent_call_started (child id),
 * then the 15s-cadence agent_call_progress poll reporting the child's
 * WAITING_FOR_APPROVAL phase. `deriveTaskStates` turns that LAST event into
 * the parent's `waiting_approval` (D-T02-14).
 */
function buildGatedStore(): WorkflowExecutionEventStore {
  const store = new WorkflowExecutionEventStore();
  const started = (seq: number, task: string) =>
    storeEvent(seq, task, WorkflowEventType.task_started, {
      case: "taskStarted",
      value: create(TaskStartedPayloadSchema, {
        taskKind: WorkflowTaskKind.agent_call,
        attemptNumber: 1,
      }),
    });
  const agentStarted = (seq: number, task: string, childId: string) =>
    storeEvent(seq, task, WorkflowEventType.agent_call_started, {
      case: "agentCallStarted",
      value: create(AgentCallStartedPayloadSchema, {
        childExecutionId: childId,
        agentSlug: "helper",
        messageSummary: "run the task",
      }),
    });
  const gatedProgress = (seq: number, task: string, childId: string) =>
    storeEvent(seq, task, WorkflowEventType.agent_call_progress, {
      case: "agentCallProgress",
      value: create(AgentCallProgressPayloadSchema, {
        childExecutionId: childId,
        agentPhase: AgentExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
        currentToolName: "",
        tokensConsumed: BigInt(0),
        messagesCount: 1,
        toolCallsCount: 1,
      }),
    });

  store.appendEvents([
    started(1, "call-helper-a"),
    agentStarted(2, "call-helper-a", "agx_child_a"),
    started(3, "call-helper-b"),
    agentStarted(4, "call-helper-b", "agx_child_b"),
    gatedProgress(5, "call-helper-a", "agx_child_a"),
    gatedProgress(6, "call-helper-b", "agx_child_b"),
  ]);
  return store;
}

/**
 * The parent snapshot both gated children surfaced onto (via the
 * call-agent orchestrator's UpdateWorkflowTaskApprovalStatus write). Task
 * snapshots carry `agent_execution_id` metadata — the inspector's
 * event-less path for resolving the AGENT_CALL child.
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
  const store = buildGatedStore();
  mockedUseWorkflowExecution.mockReturnValue({
    execution: makeExecutionWithGates(executionOverrides),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useWorkflowExecution>);
  mockedUseEventStream.mockReturnValue({
    events: store.getEvents(),
    taskStates: store.getTaskStates(),
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

/** The thread card root element for a task (its header row's parent). */
function cardRootOf(taskName: string): HTMLElement {
  const headerButton = screen.getByRole("button", {
    name: new RegExp(`^${taskName}`),
  });
  return headerButton.parentElement!.parentElement! as HTMLElement;
}

/** Select a task the way a user would — its thread card. */
function selectThreadCard(taskName: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${taskName}`) }));
}

describe("WorkflowExecutionViewer in-thread + Inspect HITL (S10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });
  afterEach(cleanup);

  it("each gating card carries its own child's 4-action gate inline; the boundary selects the last gated card WITHOUT opening the panel", () => {
    arrange();
    render(<WorkflowExecutionViewer executionId="wex_1" />);

    // Both tasks crossed into waiting_approval at mount. In Thread view the
    // panel stays closed (D-T02-13) — the cards ARE the decision surface.
    expect(screen.queryByRole("tab", { name: /Approval/ })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: /^call-helper-b/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    // Per-task scoping ON the cards: each renders exactly its child's gate,
    // with the full decision model of the shared session card — visible
    // without expanding anything (D-T02-12).
    const cardA = within(cardRootOf("call-helper-a"));
    const cardB = within(cardRootOf("call-helper-b"));
    const deleteCard = cardA.getByRole("alert", {
      name: "Approval required for delete_file",
    });
    expect(
      within(deleteCard).getByRole("button", { name: "Approve all file deletions" }),
    ).toBeTruthy();
    expect(cardA.queryByRole("alert", { name: "Approval required for shell" })).toBeNull();

    const shellCard = cardB.getByRole("alert", {
      name: "Approval required for shell",
    });
    expect(within(shellCard).getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(within(shellCard).getByRole("button", { name: "Skip" })).toBeTruthy();
    expect(within(shellCard).getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(
      within(shellCard).getByRole("button", { name: "Approve all shell commands" }),
    ).toBeTruthy();
    // The rich preview the retired thin card never had.
    expect(shellCard.textContent).toContain("npm test");
  });

  it("routes every in-card decision through the workflow-level actions instance with the gate's toolCallId", () => {
    const submitApproval = vi.fn();
    arrange(mockActions({ submitApproval }));
    render(<WorkflowExecutionViewer executionId="wex_1" />);

    fireEvent.click(
      within(cardRootOf("call-helper-b")).getByRole("button", {
        name: "Approve all shell commands",
      }),
    );
    fireEvent.click(
      within(cardRootOf("call-helper-a")).getByRole("button", { name: "Reject" }),
    );

    expect(submitApproval).toHaveBeenNthCalledWith(1, "tc_shell", ApprovalAction.APPROVE_ALL, undefined);
    expect(submitApproval).toHaveBeenNthCalledWith(2, "tc_delete", ApprovalAction.REJECT, undefined);
  });

  it("selecting a card opens Inspect on its Approval tab — the panel-side surface renders the SAME gate, still task-scoped", () => {
    arrange();
    render(<WorkflowExecutionViewer executionId="wex_1" />);

    // The boundary auto-selected call-helper-b (highlight only); clicking
    // the NOT-selected sibling is the explicit gesture that opens the panel
    // (clicking the selected card would toggle it off — the S8 contract).
    selectThreadCard("call-helper-a");

    // The inspector's status transition lands on the Approval tab (S9
    // behavior, unchanged).
    expect(
      screen.getByRole("tab", { name: /Approval/, selected: true }),
    ).toBeTruthy();
    // The selected task's gate now renders on BOTH surfaces (card +
    // Inspect) from the one snapshot + one actions instance…
    expect(
      screen.getAllByRole("alert", { name: "Approval required for delete_file" }),
    ).toHaveLength(2);
    // …while the sibling's gate stays only on its own card.
    expect(
      screen.getAllByRole("alert", { name: "Approval required for shell" }),
    ).toHaveLength(1);
  });

  it("keeps in-flight and error state per gate: one gate's failure never leaks to its sibling or the banner", () => {
    // Both gates on ONE child so one card carries both — the tightest
    // adjacency for leak detection.
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

  it("file reviews render on their own card, child-scoped, wired to the workflow-level submit", () => {
    const submitFileDecision = vi.fn();
    arrange(mockActions({ submitFileDecision }), {
      pendingApprovals: [],
      pendingFileReviews: [
        { childAgentExecutionId: "agx_child_a", changeSetId: ["cs_1"] },
        { childAgentExecutionId: "agx_child_b", changeSetId: ["cs_2"] },
      ],
    });
    render(<WorkflowExecutionViewer executionId="wex_1" />);

    // Each gating card hands ITS child's reference to the (stubbed) list.
    const cardB = within(cardRootOf("call-helper-b"));
    expect(cardB.getByText("decide-files-agx_child_b")).toBeTruthy();
    expect(cardB.queryByText("decide-files-agx_child_a")).toBeNull();

    // Decisions forward to the single actions instance (workflow RPC).
    fireEvent.click(cardB.getByText("decide-files-agx_child_b"));
    expect(submitFileDecision).toHaveBeenCalledWith("agx_child_b", "cs_2", 1);
  });
});

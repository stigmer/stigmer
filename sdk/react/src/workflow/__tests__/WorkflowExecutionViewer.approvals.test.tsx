// Composition test for the execution-level HITL surfaces (S10/T06/T07):
// gating AGENT_CALL cards carry the child's INLINE TRANSCRIPT as their
// decision surface — the child's gates decide inside it (the transcript's
// own suite covers the ApprovalCard rendering and workflow-RPC routing) —
// and the viewer's single useWorkflowExecutionActions instance is what
// reaches every card. Data hooks and heavy leaves (React Flow graph, the
// streaming transcript) are mocked exactly as in the reconciliation
// harness; this file proves the seams.
//
// REALISTIC FIXTURES (a hard S10 requirement): the gated task states are
// produced by the REAL store derivation from REAL event shapes — an
// agent_call_progress event carrying the child's WAITING_FOR_APPROVAL phase
// (D-T02-14). S9's hand-crafted `waiting_approval` states masked that
// production never emitted them for child gates; deriving through the store
// keeps these tests honest about the production path.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
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
  FileDecisionAction,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { DerivedCostSummary } from "../../internal/store/workflow-execution-event-store";
import { WorkflowExecutionEventStore } from "../../internal/store/workflow-execution-event-store";
import { useWorkflowExecution } from "../useWorkflowExecution";
import { useWorkflowExecutionEventStream } from "../useWorkflowExecutionEventStream";
import { useWorkflowExecutionArtifacts } from "../useWorkflowExecutionArtifacts";
import { useWorkflowExecutionFileChanges } from "../useWorkflowExecutionFileChanges";
import { useWorkflowExecutionActions } from "../useWorkflowExecutionActions";
import type { WorkflowAgentCallTranscriptProps } from "../WorkflowAgentCallTranscript";
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

// Fetches and streams its child (its own suite covers that, including the
// ApprovalCard rendering and the workflow-RPC routing guardrail) — stubbed
// to a probe recording the seam under test here: which child each card
// bound, and whether the viewer's hitl bundle reached it.
vi.mock("../WorkflowAgentCallTranscript", () => ({
  WorkflowAgentCallTranscript: vi.fn(
    ({ childExecutionId, hitl }: WorkflowAgentCallTranscriptProps) => (
      <div
        data-testid="transcript-probe"
        data-child-id={childExecutionId}
        data-interactive={hitl ? "true" : "false"}
      />
    ),
  ),
}));
import { WorkflowAgentCallTranscript } from "../WorkflowAgentCallTranscript";

const mockedUseWorkflowExecution = vi.mocked(useWorkflowExecution);
const mockedUseEventStream = vi.mocked(useWorkflowExecutionEventStream);
const mockedUseArtifacts = vi.mocked(useWorkflowExecutionArtifacts);
const mockedUseFileChanges = vi.mocked(useWorkflowExecutionFileChanges);
const mockedUseActions = vi.mocked(useWorkflowExecutionActions);
const mockedTranscript = vi.mocked(WorkflowAgentCallTranscript);

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

/** The parent snapshot both gated children surfaced onto. */
function makeExecutionWithGates() {
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
    },
  });
}

function mockActions() {
  return {
    cancel: vi.fn(),
    terminate: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    recover: vi.fn(),
    submitApproval: vi.fn(),
    submitTaskApproval: vi.fn(),
    submitFileDecision: vi.fn(),
    isSubmitting: false,
    error: null,
    clearError: vi.fn(),
    approvalSubmittingToolCallIds: new Set<string>(),
    approvalErrorsByToolCallId: new Map<string, Error>(),
    taskApprovalSubmittingTaskNames: new Set<string>(),
    taskApprovalErrorsByTaskName: new Map<string, Error>(),
    fileDecisionSubmittingKeys: new Set<string>(),
    fileDecisionErrorsByKey: new Map<string, Error>(),
  } as unknown as ReturnType<typeof useWorkflowExecutionActions>;
}

function arrange(actions = mockActions()) {
  const store = buildGatedStore();
  mockedUseWorkflowExecution.mockReturnValue({
    execution: makeExecutionWithGates(),
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

/**
 * The thread card root element for a task. Since T06 a preview-kind card's
 * header is a plain layout row (no role) — the shell's `data-cursor-target`
 * is the stable, gesture-independent handle on a card.
 */
function cardRootOf(taskName: string): HTMLElement {
  const root = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-cursor-target="workflow-task-row"]',
    ),
  ).find((el) => el.textContent?.includes(taskName));
  if (!root) throw new Error(`no card rendered for task "${taskName}"`);
  return root;
}

describe("WorkflowExecutionViewer in-thread HITL (S10/T06/T07)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });
  afterEach(cleanup);

  it("each gating card carries its own child's INTERACTIVE transcript inline; the boundary never opens the panel", () => {
    arrange();
    render(<WorkflowExecutionViewer executionId="wex_1" />);

    // Both tasks crossed into waiting_approval at mount (derived by the
    // REAL store from real agent_call_progress events — D-T02-14). The
    // panel stays closed — the cards ARE the (only) decision surface, and
    // selection died with the Inspect drill-down.
    expect(screen.queryByRole("tab", { name: /Approval/ })).toBeNull();
    expect(document.querySelector("[aria-pressed]")).toBeNull();

    // Per-card scoping: each card mounts ITS child's transcript, made
    // interactive by the gate (the hitl bundle reached it) — the child's
    // ApprovalCards render inside it (the transcript's own suite).
    const probeIn = (taskName: string) =>
      within(cardRootOf(taskName)).getByTestId("transcript-probe");
    expect(probeIn("call-helper-a").getAttribute("data-child-id")).toBe(
      "agx_child_a",
    );
    expect(probeIn("call-helper-a").getAttribute("data-interactive")).toBe(
      "true",
    );
    expect(probeIn("call-helper-b").getAttribute("data-child-id")).toBe(
      "agx_child_b",
    );
    expect(probeIn("call-helper-b").getAttribute("data-interactive")).toBe(
      "true",
    );
  });

  it("hands each transcript the viewer's SINGLE actions instance — decisions route through the workflow-level RPCs (S5 guardrail)", () => {
    const actions = arrange();
    render(<WorkflowExecutionViewer executionId="wex_1" />);

    // The transcript submits through the SAME workflow-level handlers
    // every other surface uses, so in-flight and error state can never
    // fork — and never the child's agentExecution.* path (checked
    // exhaustively in WorkflowAgentCallTranscript.test.tsx). State fields
    // pass by IDENTITY; the submit fns are asserted by DELEGATION since
    // the thread's scroll-on-send wrapper (stigmer-cloud#267) pins the
    // view before handing each call to the single instance — a per-card
    // duplicate would still fail here, because the delegate IS the
    // viewer's own spy.
    expect(mockedTranscript.mock.calls.length).toBeGreaterThan(0);
    for (const call of mockedTranscript.mock.calls) {
      const hitl = call[0].hitl!;
      hitl.submitApproval("tc-probe", ApprovalAction.APPROVE);
      expect(actions.submitApproval).toHaveBeenLastCalledWith(
        "tc-probe",
        ApprovalAction.APPROVE,
      );
      hitl.submitFileDecision("agx-probe", "cs-probe", FileDecisionAction.APPROVE);
      expect(actions.submitFileDecision).toHaveBeenLastCalledWith(
        "agx-probe",
        "cs-probe",
        FileDecisionAction.APPROVE,
      );
      expect(hitl.approvalSubmittingToolCallIds).toBe(
        actions.approvalSubmittingToolCallIds,
      );
      expect(hitl.approvalErrorsByToolCallId).toBe(
        actions.approvalErrorsByToolCallId,
      );
    }
  });

  it("renders each child's transcript on exactly ONE surface — its own card (no document tab, no Inspect duplicate)", () => {
    arrange();
    render(<WorkflowExecutionViewer executionId="wex_1" />);

    const probes = screen.getAllByTestId("transcript-probe");
    expect(probes).toHaveLength(2);
    expect(
      new Set(probes.map((p) => p.getAttribute("data-child-id"))).size,
    ).toBe(2);
    expect(screen.queryByRole("button", { name: "Open transcript" })).toBeNull();
  });
});

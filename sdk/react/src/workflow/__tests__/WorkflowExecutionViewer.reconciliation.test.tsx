// Composition test for the reconciled single-panel layout: the viewer's real
// wiring from a task selection to the panel's Inspect facet, the header's
// Diagnose button to the diagnosis editor document, and the Usage facet's
// absorbed budget gauge. Data hooks and heavy leaves (React Flow graph,
// streaming repair card, inspector internals) are mocked — each has its own
// suite; this file proves the seams between them.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  ExecutionPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
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

// The graph is React Flow — replaced with a stub that exposes the two
// selection callbacks the viewer wires (user click vs. runner auto-focus).
// memo + a render counter make it double as the DD-009 probe: if the viewer
// hands the graph a fresh prop identity on selection changes (e.g. an
// inline handler), the memo stops bailing and the counter catches it.
const graphRenders = { count: 0 };
vi.mock("../WorkflowExecutionGraph", async () => {
  const { memo } = await import("react");
  return {
    WorkflowExecutionGraph: memo(function WorkflowExecutionGraphStub({
      onTaskSelect,
      onAutoSelectTask,
    }: {
      onTaskSelect?: (name: string | null) => void;
      onAutoSelectTask?: (name: string) => void;
    }) {
      graphRenders.count += 1;
      return (
        <div data-testid="graph-stub">
          <button type="button" onClick={() => onTaskSelect?.("build-report")}>
            click-node
          </button>
          <button type="button" onClick={() => onTaskSelect?.(null)}>
            click-pane
          </button>
          <button
            type="button"
            onClick={() => onAutoSelectTask?.("build-report")}
          >
            auto-focus-node
          </button>
        </div>
      );
    }),
  };
});

// The diagnosis conversation streams; the seam under test is only that the
// viewer mounts it as the diagnosis document and routes its onClose.
vi.mock("../WorkflowRepairCard", () => ({
  WorkflowRepairCard: ({ onClose }: { onClose?: () => void }) => (
    <div data-testid="repair-card-stub">
      <button type="button" onClick={onClose}>
        close-diagnosis
      </button>
    </div>
  ),
}));

// The inspector has its own suite; here it only needs to prove WHERE it
// renders and WHICH task it received.
vi.mock("../execution-inspector/ExecutionInspector", () => ({
  ExecutionInspector: ({
    selectedTaskName,
  }: {
    selectedTaskName: string | null;
  }) => <div data-testid="inspector-stub">{selectedTaskName}</div>,
}));

vi.mock("../execution-comparison/ExecutionComparisonPicker", () => ({
  ExecutionComparisonPicker: () => null,
}));

vi.mock("../waterfall/index.js", () => ({
  WaterfallTimeline: () => <div data-testid="waterfall-stub" />,
}));

const mockedUseWorkflowExecution = vi.mocked(useWorkflowExecution);
const mockedUseEventStream = vi.mocked(useWorkflowExecutionEventStream);
const mockedUseArtifacts = vi.mocked(useWorkflowExecutionArtifacts);
const mockedUseFileChanges = vi.mocked(useWorkflowExecutionFileChanges);
const mockedUseActions = vi.mocked(useWorkflowExecutionActions);

function makeExecution(phase: ExecutionPhase) {
  return create(WorkflowExecutionSchema, {
    metadata: { id: "wex_1", name: "nightly-report" },
    spec: { workflowId: "wf_1" },
    status: {
      phase,
      startedAt: "2026-07-15T00:00:00Z",
      completedAt: "2026-07-15T00:01:00Z",
      tasks: [
        {
          taskName: "build-report",
          status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
          startedAt: "2026-07-15T00:00:00Z",
          completedAt: "2026-07-15T00:00:30Z",
        },
      ],
    },
  });
}

const COST_SUMMARY: DerivedCostSummary = {
  costConsumedMicros: 500_000n,
  costRemainingMicros: 500_000n, // limit known → the absorbed gauge renders
  tokensConsumed: 1_000n,
  tokensRemaining: -1n, // no token limit → no token gauge
  thresholdBreached: false,
};

function taskState(name: string): DerivedTaskState {
  return {
    taskName: name,
    taskKind: 0,
    status: "completed",
    durationMs: 30_000,
    costMicros: 500_000n,
    tokensUsed: 1_000n,
    attemptNumber: 1,
    error: "",
    childExecutionId: "",
    agentSlug: "",
    currentToolName: "",
    messagesCount: 0,
    toolCallsCount: 0,
  } as DerivedTaskState;
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

function arrange(phase: ExecutionPhase = ExecutionPhase.EXECUTION_COMPLETED) {
  mockedUseWorkflowExecution.mockReturnValue({
    execution: makeExecution(phase),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useWorkflowExecution>);
  mockedUseEventStream.mockReturnValue({
    events: [],
    taskStates: new Map([["build-report", taskState("build-report")]]),
    costSummary: COST_SUMMARY,
    streamState: { stage: "complete" },
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
  mockedUseActions.mockReturnValue(mockActions());
}

function renderViewer(props?: { org?: string }) {
  return render(
    <WorkflowExecutionViewer executionId="wex_1" org={props?.org} />,
  );
}

describe("WorkflowExecutionViewer (reconciled single-panel layout)", () => {
  beforeEach(() => arrange());
  afterEach(cleanup);

  it("starts two-column: graph only, panel collapsed to the chip, no inspector aside", () => {
    renderViewer();
    expect(screen.getByTestId("graph-stub")).toBeTruthy();
    expect(screen.queryByTestId("inspector-stub")).toBeNull();
    // The retired aside's empty-state hint must be gone.
    expect(
      screen.queryByText("Click a node to view execution details"),
    ).toBeNull();
  });

  it("a node click opens the panel on the Inspect facet showing that task", () => {
    renderViewer();

    fireEvent.click(screen.getByRole("button", { name: "click-node" }));

    const inspector = screen.getByTestId("inspector-stub");
    expect(inspector.textContent).toBe("build-report");
    expect(
      screen.getByRole("radio", { name: "Inspect" }).getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
  });

  it("the runner's auto-focus never opens a collapsed panel", () => {
    renderViewer();

    fireEvent.click(screen.getByRole("button", { name: "auto-focus-node" }));

    expect(screen.queryByTestId("inspector-stub")).toBeNull();
  });

  it("deselecting (pane click) drops the contextual Inspect view for the home facet", () => {
    renderViewer();
    fireEvent.click(screen.getByRole("button", { name: "click-node" }));
    expect(screen.getByTestId("inspector-stub")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "click-pane" }));

    expect(screen.queryByTestId("inspector-stub")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Inspect" })).toBeNull();
    // Panel stays open on its home facet — deselection is not a dismissal.
    expect(
      screen
        .getByRole("radio", { name: "Artifacts" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("Diagnose opens the diagnosis document in the panel's editor area; its close button closes the tab", () => {
    arrange(ExecutionPhase.EXECUTION_FAILED);
    renderViewer({ org: "acme" });

    fireEvent.click(screen.getByRole("button", { name: "Diagnose" }));

    expect(screen.getByTestId("repair-card-stub")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /AI Diagnosis/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "close-diagnosis" }));
    expect(screen.queryByTestId("repair-card-stub")).toBeNull();
    expect(screen.queryByRole("tab", { name: /AI Diagnosis/ })).toBeNull();
  });

  it("Diagnose is idempotent — a re-click focuses the one diagnosis tab", () => {
    arrange(ExecutionPhase.EXECUTION_FAILED);
    renderViewer({ org: "acme" });

    fireEvent.click(screen.getByRole("button", { name: "Diagnose" }));
    fireEvent.click(screen.getByRole("button", { name: "Diagnose" }));

    expect(screen.getAllByRole("tab", { name: /AI Diagnosis/ })).toHaveLength(
      1,
    );
  });

  it("the Usage facet carries the absorbed budget gauge (the retired cost panel's bars)", () => {
    renderViewer();
    fireEvent.click(screen.getByRole("button", { name: "click-node" }));
    fireEvent.click(screen.getByRole("radio", { name: "Usage" }));

    // Cost limit known (remaining >= 0) → one gauge at 50%.
    const gauge = screen.getByRole("progressbar");
    expect(gauge.getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("selection and panel interactions never re-render the graph (DD-009/DD-010)", () => {
    renderViewer();
    const rendersAfterMount = graphRenders.count;

    // Node select → panel opens to Inspect; facet switch; deselect.
    fireEvent.click(screen.getByRole("button", { name: "click-node" }));
    fireEvent.click(screen.getByRole("radio", { name: "Usage" }));
    fireEvent.click(screen.getByRole("button", { name: "click-pane" }));

    expect(graphRenders.count).toBe(rendersAfterMount);
  });
});

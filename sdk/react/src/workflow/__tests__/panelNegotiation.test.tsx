import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import type { DerivedCostSummary } from "../../internal/store/workflow-execution-event-store";
import { useWorkflowExecution } from "../useWorkflowExecution";
import { useWorkflowExecutionEventStream } from "../useWorkflowExecutionEventStream";
import { useWorkflowExecutionArtifacts } from "../useWorkflowExecutionArtifacts";
import { useWorkflowExecutionFileChanges } from "../useWorkflowExecutionFileChanges";
import { useWorkflowExecutionActions } from "../useWorkflowExecutionActions";
import { WorkflowExecutionViewer } from "../WorkflowExecutionViewer";

// ---------------------------------------------------------------------------
// Wiring-contract tests for the execution panel's host-negotiation surface
// (issue #654): `panel="none"` omission, `defaultPanelOpen`, and the
// controlled/observed `panelOpen` + `onPanelOpenChange` pair — the workflow
// mirror of the session organisms' #651 contract (see the session
// panelNegotiation suite). Workflow-specific beat: Diagnose gates on the
// panel too, because its conversation renders inside the panel.
//
// Same probe/stub setup as the approvals suite: data hooks are stubbed to a
// loaded, task-less execution; the graph and comparison picker are inert.
// ---------------------------------------------------------------------------

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

function arrange(phase: ExecutionPhase = ExecutionPhase.EXECUTION_IN_PROGRESS) {
  mockedUseWorkflowExecution.mockReturnValue({
    execution: create(WorkflowExecutionSchema, {
      metadata: { id: "wex_1", name: "nightly-report" },
      spec: { workflowId: "wf_1" },
      status: { phase, startedAt: "2026-07-15T00:00:00Z", tasks: [] },
    }),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useWorkflowExecution>);
  mockedUseEventStream.mockReturnValue({
    events: [],
    taskStates: new Map(),
    costSummary: COST_SUMMARY,
    streamState: { stage: "streaming" },
    totalTasks: 0,
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
  } as unknown as ReturnType<typeof useWorkflowExecutionFileChanges>);
  mockedUseActions.mockReturnValue({
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
  } as unknown as ReturnType<typeof useWorkflowExecutionActions>);
}

function chipButton(): HTMLElement | null {
  return (
    screen.queryByRole("button", { name: "Show panel" }) ??
    screen.queryByRole("button", { name: "Hide panel" })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(cleanup);

describe('WorkflowExecutionViewer — panel="none"', () => {
  it("removes the chip and never renders the panel", () => {
    arrange();
    render(<WorkflowExecutionViewer executionId="wex_1" panel="none" />);
    expect(chipButton()).toBeNull();
  });

  it("withholds Diagnose — its conversation renders inside the panel", () => {
    arrange(ExecutionPhase.EXECUTION_FAILED);
    render(
      <WorkflowExecutionViewer executionId="wex_1" org="acme" panel="none" />,
    );
    expect(screen.queryByRole("button", { name: "Diagnose" })).toBeNull();
    // The failed-state actions that live OUTSIDE the panel are untouched.
    expect(screen.getByRole("button", { name: "Recover" })).toBeDefined();
  });

  it("keeps controlled props inert — panelOpen cannot force a surface that does not exist", () => {
    arrange();
    const onPanelOpenChange = vi.fn();
    render(
      <WorkflowExecutionViewer
        executionId="wex_1"
        panel="none"
        panelOpen={true}
        onPanelOpenChange={onPanelOpenChange}
      />,
    );
    expect(chipButton()).toBeNull();
    expect(onPanelOpenChange).not.toHaveBeenCalled();
  });
});

describe("WorkflowExecutionViewer — Diagnose in the default panel mode", () => {
  it("offers Diagnose on a failed execution (the contrast for the none-mode withholding)", () => {
    arrange(ExecutionPhase.EXECUTION_FAILED);
    render(<WorkflowExecutionViewer executionId="wex_1" org="acme" />);
    expect(screen.getByRole("button", { name: "Diagnose" })).toBeDefined();
  });
});

describe("WorkflowExecutionViewer — observed panel state (uncontrolled + onPanelOpenChange)", () => {
  it("reports chip toggles without taking control", () => {
    arrange();
    const seen: boolean[] = [];
    render(
      <WorkflowExecutionViewer
        executionId="wex_1"
        onPanelOpenChange={(open) => seen.push(open)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));
    expect(seen).toEqual([true]);
    fireEvent.click(screen.getByRole("button", { name: "Hide panel" }));
    expect(seen).toEqual([true, false]);
  });

  it("starts open with defaultPanelOpen, without a spurious notification", () => {
    arrange();
    const onPanelOpenChange = vi.fn();
    render(
      <WorkflowExecutionViewer
        executionId="wex_1"
        defaultPanelOpen
        onPanelOpenChange={onPanelOpenChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Hide panel" })).toBeDefined();
    expect(onPanelOpenChange).not.toHaveBeenCalled();
  });
});

describe("WorkflowExecutionViewer — controlled panel state", () => {
  it("follows panelOpen and surfaces the chip's request without applying it", () => {
    arrange();
    const seen: boolean[] = [];
    const onPanelOpenChange = (open: boolean) => seen.push(open);
    const { rerender } = render(
      <WorkflowExecutionViewer
        executionId="wex_1"
        panelOpen={false}
        onPanelOpenChange={onPanelOpenChange}
      />,
    );

    // The chip requests; the host owns the state — nothing moves yet.
    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));
    expect(seen).toEqual([true]);
    expect(screen.getByRole("button", { name: "Show panel" })).toBeDefined();

    // The host grants the request: the panel opens and the chip flips.
    rerender(
      <WorkflowExecutionViewer
        executionId="wex_1"
        panelOpen={true}
        onPanelOpenChange={onPanelOpenChange}
      />,
    );
    expect(screen.getByRole("button", { name: "Hide panel" })).toBeDefined();
  });
});

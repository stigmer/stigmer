import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import type { DerivedCostSummary } from "../../internal/store/workflow-run-event-store";
import { useWorkflowRun } from "../useWorkflowRun";
import { useWorkflowRunEventStream } from "../useWorkflowRunEventStream";
import { useWorkflowRunArtifacts } from "../useWorkflowRunArtifacts";
import { useWorkflowRunFileChanges } from "../useWorkflowRunFileChanges";
import { useWorkflowRunActions } from "../useWorkflowRunActions";
import { WorkflowRunViewer } from "../WorkflowRunViewer";

// ---------------------------------------------------------------------------
// Wiring-contract tests for the run panel's host-negotiation surface
// (issue #654): `panel="none"` omission, `defaultPanelOpen`, and the
// controlled/observed `panelOpen` + `onPanelOpenChange` pair — the workflow
// mirror of the session organisms' #651 contract (see the session
// panelNegotiation suite). Workflow-specific beat: Diagnose gates on the
// panel too, because its conversation renders inside the panel.
//
// Same probe/stub setup as the approvals suite: data hooks are stubbed to a
// loaded, task-less run; the graph and comparison picker are inert.
// ---------------------------------------------------------------------------

vi.mock("../useWorkflowRun", () => ({
  useWorkflowRun: vi.fn(),
}));
vi.mock("../useWorkflowRunEventStream", () => ({
  useWorkflowRunEventStream: vi.fn(),
}));
vi.mock("../useWorkflowRunArtifacts", () => ({
  useWorkflowRunArtifacts: vi.fn(),
}));
vi.mock("../useWorkflowRunFileChanges", () => ({
  useWorkflowRunFileChanges: vi.fn(),
}));
vi.mock("../useWorkflowRunActions", () => ({
  useWorkflowRunActions: vi.fn(),
}));
vi.mock("../WorkflowRunGraph", () => ({
  WorkflowRunGraph: () => <div data-testid="graph-stub" />,
}));
vi.mock("../run-comparison/RunComparisonPicker", () => ({
  RunComparisonPicker: () => null,
}));

// Diagnose also gates on the Organization's Workflow Architect existing
// (workflow-architect.ts). The probe is a data hook over the client and this
// suite renders without a provider; it answers "available" here so the
// panel negotiation stays the one thing under test (the reconciliation
// suite covers the architect gate itself).
vi.mock("../workflow-architect", () => ({
  useWorkflowArchitect: () => ({
    availability: "available",
    agent: null,
    error: null,
  }),
}));

const mockedUseWorkflowExecution = vi.mocked(useWorkflowRun);
const mockedUseEventStream = vi.mocked(useWorkflowRunEventStream);
const mockedUseArtifacts = vi.mocked(useWorkflowRunArtifacts);
const mockedUseFileChanges = vi.mocked(useWorkflowRunFileChanges);
const mockedUseActions = vi.mocked(useWorkflowRunActions);

const COST_SUMMARY: DerivedCostSummary = {
  costConsumedMicros: 0n,
  costRemainingMicros: -1n,
  tokensConsumed: 0n,
  tokensRemaining: -1n,
  thresholdBreached: false,
};

function arrange(phase: RunPhase = RunPhase.RUN_IN_PROGRESS) {
  mockedUseWorkflowExecution.mockReturnValue({
    run: create(WorkflowRunSchema, {
      metadata: { id: "wex_1", name: "nightly-report" },
      spec: { workflowId: "wf_1" },
      status: { phase, startedAt: "2026-07-15T00:00:00Z", tasks: [] },
    }),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useWorkflowRun>);
  mockedUseEventStream.mockReturnValue({
    events: [],
    taskStates: new Map(),
    costSummary: COST_SUMMARY,
    streamState: { stage: "streaming" },
    totalTasks: 0,
    error: null,
    reconnect: vi.fn(),
  } as unknown as ReturnType<typeof useWorkflowRunEventStream>);
  mockedUseArtifacts.mockReturnValue({
    artifacts: [],
  } as unknown as ReturnType<typeof useWorkflowRunArtifacts>);
  mockedUseFileChanges.mockReturnValue({
    fileChanges: [],
    fileChangeCount: 0,
    isLoading: false,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useWorkflowRunFileChanges>);
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
  } as unknown as ReturnType<typeof useWorkflowRunActions>);
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

describe('WorkflowRunViewer — panel="none"', () => {
  it("removes the chip and never renders the panel", () => {
    arrange();
    render(<WorkflowRunViewer runId="wex_1" panel="none" />);
    expect(chipButton()).toBeNull();
  });

  it("withholds Diagnose — its conversation renders inside the panel", () => {
    arrange(RunPhase.RUN_FAILED);
    render(
      <WorkflowRunViewer runId="wex_1" org="acme" panel="none" />,
    );
    expect(screen.queryByRole("button", { name: "Diagnose" })).toBeNull();
    // The failed-state actions that live OUTSIDE the panel are untouched.
    expect(screen.getByRole("button", { name: "Recover" })).toBeDefined();
  });

  it("keeps controlled props inert — panelOpen cannot force a surface that does not exist", () => {
    arrange();
    const onPanelOpenChange = vi.fn();
    render(
      <WorkflowRunViewer
        runId="wex_1"
        panel="none"
        panelOpen={true}
        onPanelOpenChange={onPanelOpenChange}
      />,
    );
    expect(chipButton()).toBeNull();
    expect(onPanelOpenChange).not.toHaveBeenCalled();
  });
});

describe("WorkflowRunViewer — Diagnose in the default panel mode", () => {
  it("offers Diagnose on a failed execution (the contrast for the none-mode withholding)", () => {
    arrange(RunPhase.RUN_FAILED);
    render(<WorkflowRunViewer runId="wex_1" org="acme" />);
    expect(screen.getByRole("button", { name: "Diagnose" })).toBeDefined();
  });
});

describe("WorkflowRunViewer — observed panel state (uncontrolled + onPanelOpenChange)", () => {
  it("reports chip toggles without taking control", () => {
    arrange();
    const seen: boolean[] = [];
    render(
      <WorkflowRunViewer
        runId="wex_1"
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
      <WorkflowRunViewer
        runId="wex_1"
        defaultPanelOpen
        onPanelOpenChange={onPanelOpenChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Hide panel" })).toBeDefined();
    expect(onPanelOpenChange).not.toHaveBeenCalled();
  });
});

describe("WorkflowRunViewer — controlled panel state", () => {
  it("follows panelOpen and surfaces the chip's request without applying it", () => {
    arrange();
    const seen: boolean[] = [];
    const onPanelOpenChange = (open: boolean) => seen.push(open);
    const { rerender } = render(
      <WorkflowRunViewer
        runId="wex_1"
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
      <WorkflowRunViewer
        runId="wex_1"
        panelOpen={true}
        onPanelOpenChange={onPanelOpenChange}
      />,
    );
    expect(screen.getByRole("button", { name: "Hide panel" })).toBeDefined();
  });
});

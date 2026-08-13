// Composition test for the reconciled single-panel layout (T06 shape): the
// thread-primary center with the passive graph behind the toggle, the
// workspace-only side panel (Artifacts/Changes/Usage — no Inspect facet
// anywhere), the header's Diagnose button to the diagnosis editor document,
// and the Usage facet's absorbed budget gauge. Data hooks and heavy leaves
// (React Flow graph, streaming repair card) are mocked — each has its own
// suite; this file proves the seams between them.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ApprovalRequestedPayloadSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
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

// The graph is React Flow — replaced with a memoized stub whose render
// counter is the DD-009 probe: if the viewer hands the graph a fresh prop
// identity on panel interactions (e.g. an inline handler), the memo stops
// bailing and the counter catches it. Since T06 the graph is a passive
// visualization — the stub records its props so the suite can assert no
// selection callback is ever wired.
const graphRenders = { count: 0 };
const graphProps = { last: {} as Record<string, unknown> };
vi.mock("../WorkflowExecutionGraph", async () => {
  const { memo } = await import("react");
  return {
    WorkflowExecutionGraph: memo(function WorkflowExecutionGraphStub(
      props: Record<string, unknown>,
    ) {
      graphRenders.count += 1;
      graphProps.last = props;
      return <div data-testid="graph-stub" />;
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

vi.mock("../execution-comparison/ExecutionComparisonPicker", () => ({
  ExecutionComparisonPicker: () => null,
}));

// The inline child transcript fetches and streams (its own suite covers
// that); here it only proves the thread mounts it in the AGENT_CALL card
// with the right child identity (T07).
vi.mock("../WorkflowAgentCallTranscript", () => ({
  WorkflowAgentCallTranscript: ({
    childExecutionId,
    agentSlug,
  }: {
    childExecutionId: string;
    agentSlug?: string;
  }) => (
    <div data-testid="agent-transcript-stub">
      {childExecutionId}:{agentSlug ?? ""}
    </div>
  ),
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
    inputSummary: null,
    outputSummary: null,
    approvalRequest: null,
    approvalResolution: null,
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
  const refetch = vi.fn();
  mockedUseWorkflowExecution.mockReturnValue({
    execution: makeExecution(phase),
    isLoading: false,
    error: null,
    refetch,
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
  return { refetch };
}

function renderViewer(props?: { org?: string }) {
  return render(
    <WorkflowExecutionViewer executionId="wex_1" org={props?.org} />,
  );
}

describe("WorkflowExecutionViewer (reconciled single-panel layout)", () => {
  beforeEach(() => {
    // The center view persists to localStorage — isolate tests from each
    // other (and from ResizableSplit's persisted widths).
    localStorage.clear();
    arrange();
  });
  afterEach(cleanup);

  it("starts two-column: center column with the panel collapsed to the chip, no inspector aside", () => {
    renderViewer();
    // Both center views are mounted (the inactive one CSS-hidden).
    expect(screen.getByTestId("graph-stub")).toBeTruthy();
    // The retired aside's empty-state hint must be gone.
    expect(
      screen.queryByText("Click a node to view execution details"),
    ).toBeNull();
  });

  it("carries no bottom drawer — Waterfall, Events, and Approvals tabs are retired (S9)", () => {
    renderViewer();
    expect(screen.queryByRole("button", { name: "Waterfall" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Events/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Approvals/ })).toBeNull();
  });

  it("wires no selection callbacks into the graph — a passive visualization (T06)", () => {
    renderViewer();
    expect("onTaskSelect" in graphProps.last).toBe(false);
    expect("onAutoSelectTask" in graphProps.last).toBe(false);
  });

  it("the open panel offers exactly Artifacts, Changes, and Usage — no Inspect facet exists (T06)", () => {
    renderViewer();

    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));

    expect(screen.getByRole("radio", { name: "Artifacts" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Changes" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Usage" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Inspect" })).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));
    fireEvent.click(screen.getByRole("radio", { name: "Usage" }));

    // Cost limit known (remaining >= 0) → one gauge at 50%.
    const gauge = screen.getByRole("progressbar");
    expect(gauge.getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("panel interactions never re-render the graph (DD-009/DD-010)", () => {
    renderViewer();
    const rendersAfterMount = graphRenders.count;

    // Panel open → facet switch → collapse.
    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));
    fireEvent.click(screen.getByRole("radio", { name: "Usage" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide panel" }));

    expect(graphRenders.count).toBe(rendersAfterMount);
  });
});

// ---------------------------------------------------------------------------
// S9: center-column Thread | Graph toggle (thread is primary)
// ---------------------------------------------------------------------------

describe("WorkflowExecutionViewer (center-column Thread|Graph toggle, S9)", () => {
  beforeEach(() => {
    localStorage.clear();
    arrange();
  });
  afterEach(cleanup);

  function centerWrappers(container: HTMLElement) {
    const graph = container.querySelector('[data-center-view="graph"]');
    const thread = container.querySelector('[data-center-view="thread"]');
    if (!graph || !thread) throw new Error("center view wrappers missing");
    return { graph, thread };
  }

  it("defaults to Thread with the graph mounted but CSS-hidden", () => {
    const { container } = renderViewer();
    const { graph, thread } = centerWrappers(container);

    expect(thread.classList.contains("stg:hidden")).toBe(false);
    expect(graph.classList.contains("stg:hidden")).toBe(true);
    // Mounted, never conditionally rendered (DD-009).
    expect(screen.getByTestId("graph-stub")).toBeTruthy();
    expect(
      screen
        .getByRole("radio", { name: "Thread" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("a stored S8 (unversioned) preference is abandoned — the pivot's one-time reset", () => {
    localStorage.setItem("stgm-wf-exec-center-view", "graph");
    const { container } = renderViewer();

    const { thread } = centerWrappers(container);
    expect(thread.classList.contains("stg:hidden")).toBe(false);
    // The legacy key is cleaned up on mount.
    expect(localStorage.getItem("stgm-wf-exec-center-view")).toBeNull();
  });

  it("toggling to Graph reveals the graph, hides (never unmounts) the thread, and persists the v2 key", () => {
    const { container } = renderViewer();

    fireEvent.click(screen.getByRole("radio", { name: "Graph" }));

    const { graph, thread } = centerWrappers(container);
    expect(graph.classList.contains("stg:hidden")).toBe(false);
    expect(thread.classList.contains("stg:hidden")).toBe(true);
    expect(localStorage.getItem("stgm-wf-exec-center-view.v2")).toBe("graph");
  });

  it("a persisted v2 Graph choice is respected on the next mount", () => {
    localStorage.setItem("stgm-wf-exec-center-view.v2", "graph");
    const { container } = renderViewer();

    const { graph } = centerWrappers(container);
    expect(graph.classList.contains("stg:hidden")).toBe(false);
    expect(
      screen.getByRole("radio", { name: "Graph" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("toggling views never re-renders the settled graph (DD-009)", () => {
    renderViewer();
    const rendersAfterMount = graphRenders.count;

    fireEvent.click(screen.getByRole("radio", { name: "Graph" }));
    fireEvent.click(screen.getByRole("radio", { name: "Thread" }));

    expect(graphRenders.count).toBe(rendersAfterMount);
  });

  it("a thread card offers no selection or drill-down gesture — the card IS the surface (T06)", () => {
    renderViewer();

    // build-report has kind 0 (unspecified → summary disclosure): its header
    // is the expand gesture, never a selection.
    const header = screen.getByRole("button", { name: /^build-report/ });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(header.getAttribute("aria-pressed")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Inspect build-report" }),
    ).toBeNull();

    fireEvent.click(header);

    // Expansion is card-local; the panel never opens on a card gesture.
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("radio", { name: "Inspect" })).toBeNull();
  });

  it("a gating human_input renders its review form ON the card — the viewer threads the task-approval wiring (T06)", () => {
    arrange(ExecutionPhase.EXECUTION_IN_PROGRESS);
    mockedUseEventStream.mockReturnValue({
      events: [],
      taskStates: new Map([
        [
          "review-gate",
          {
            ...taskState("review-gate"),
            taskKind: 16, // WorkflowTaskKind.human_input
            status: "waiting_approval",
            approvalRequest: create(ApprovalRequestedPayloadSchema, {
              prompt: "Ship it?",
              outcomes: [{ name: "ship", label: "Ship It" }],
            }),
          },
        ],
      ]),
      costSummary: COST_SUMMARY,
      streamState: { stage: "streaming" },
      totalTasks: 1,
      error: null,
      reconnect: vi.fn(),
    } as unknown as ReturnType<typeof useWorkflowExecutionEventStream>);
    renderViewer();

    const form = screen.getByRole("form", {
      name: "Approval decision for review-gate",
    });
    expect(form).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Ship It" }));
    expect(
      vi.mocked(useWorkflowExecutionActions).mock.results.at(-1)?.value
        .submitTaskApproval,
    ).toHaveBeenCalledWith("review-gate", "ship", undefined, undefined);
  });

  it("an AGENT_CALL card renders the child's inline transcript in the thread — no document tab, no launcher (T07)", () => {
    // Add a settled agent-call task carrying its child execution id. The
    // stream stage must not be "complete" with zero events, or the viewer's
    // snapshot fallback would replace these derived states (its documented
    // event-persistence-failure path).
    mockedUseEventStream.mockReturnValue({
      events: [],
      taskStates: new Map([
        ["build-report", taskState("build-report")],
        [
          "call-writer",
          {
            ...taskState("call-writer"),
            taskKind: 13, // WorkflowTaskKind.agent_call
            agentSlug: "blog-writer",
            childExecutionId: "aex_child_1",
          },
        ],
      ]),
      costSummary: COST_SUMMARY,
      streamState: { stage: "idle" },
      totalTasks: 2,
      error: null,
      reconnect: vi.fn(),
    } as unknown as ReturnType<typeof useWorkflowExecutionEventStream>);
    renderViewer();

    // The transcript is IN the card body, bound to the right child, with
    // no launcher gesture in between — the card is the single home.
    expect(screen.getByTestId("agent-transcript-stub").textContent).toBe(
      "aex_child_1:blog-writer",
    );
    expect(
      screen.queryByRole("button", { name: "Open transcript" }),
    ).toBeNull();
  });

  it("keeps exactly one aria-live announcer across both center views", () => {
    const { container } = renderViewer();

    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio", { name: "Graph" }));
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// S9: approval-boundary wiring (snapshot refresh + gate attention)
// ---------------------------------------------------------------------------

describe("WorkflowExecutionViewer (approval boundary, S9)", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(cleanup);

  // Re-mocks ONLY the stream (the execution mock — and its refetch spy —
  // must stay stable across the flip, since the assertions count its calls).
  function mockStream(status: DerivedTaskState["status"]) {
    mockedUseEventStream.mockReturnValue({
      events: [],
      taskStates: new Map([
        ["build-report", { ...taskState("build-report"), status }],
      ]),
      costSummary: COST_SUMMARY,
      streamState: { stage: "streaming" },
      totalTasks: 1,
      error: null,
      reconnect: vi.fn(),
    } as unknown as ReturnType<typeof useWorkflowExecutionEventStream>);
  }

  it("a gate opening mid-run refetches the snapshot WITHOUT opening the panel or selecting anything (T06)", () => {
    const { refetch } = arrange(ExecutionPhase.EXECUTION_IN_PROGRESS);
    mockStream("running");
    const { rerender } = render(<WorkflowExecutionViewer executionId="wex_1" />);
    expect(refetch).not.toHaveBeenCalled();

    // The stream flips the task across the waiting_approval boundary. The
    // viewer is memoized, so a rerender with identical props would bail
    // before re-reading the mocked stream — vary a benign prop to deliver
    // the new stream value (in production the store subscription re-renders
    // the viewer without any prop change).
    mockStream("waiting_approval");
    rerender(
      <WorkflowExecutionViewer executionId="wex_1" className="pass-2" />,
    );

    // The refetch materializes the snapshot's gate lists for the in-card
    // decision surfaces…
    expect(refetch).toHaveBeenCalledTimes(1);
    // …with no auto-select and no panel yank: the gating card is amber and
    // carries its own decision surface (selection died with Inspect, T06).
    expect(document.querySelector("[aria-pressed]")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Inspect" })).toBeNull();
  });

  it("a gate resolving also refetches — decided gates never linger", () => {
    const { refetch } = arrange(ExecutionPhase.EXECUTION_IN_PROGRESS);
    mockStream("waiting_approval");
    const { rerender } = render(<WorkflowExecutionViewer executionId="wex_1" />);
    // Mount observed the gate already open → one entering crossing.
    expect(refetch).toHaveBeenCalledTimes(1);

    mockStream("running");
    // Benign prop change to get past the viewer's memo (see above).
    rerender(
      <WorkflowExecutionViewer executionId="wex_1" className="pass-2" />,
    );

    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("terminal-execution replay never refetches", () => {
    const { refetch } = arrange(ExecutionPhase.EXECUTION_COMPLETED);
    mockStream("waiting_approval");
    render(<WorkflowExecutionViewer executionId="wex_1" />);

    expect(refetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T04: terminal-phase snapshot refetch (DD-T04-4)
// ---------------------------------------------------------------------------

describe("WorkflowExecutionViewer (terminal-phase refetch, T04)", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(cleanup);

  // Re-mocks ONLY the stream stage (the execution mock — and its refetch
  // spy — must stay stable across the flip; the assertions count its calls).
  function mockStreamStage(
    stage: "connecting" | "streaming" | "reconnecting" | "complete",
  ) {
    mockedUseEventStream.mockReturnValue({
      events: [],
      taskStates: new Map([
        ["build-report", { ...taskState("build-report"), status: "running" }],
      ]),
      costSummary: COST_SUMMARY,
      streamState:
        stage === "reconnecting"
          ? { stage, executionId: "wex_1", attempt: 1, error: new Error("drop") }
          : { stage, executionId: "wex_1" },
      totalTasks: 1,
      error: null,
      reconnect: vi.fn(),
    } as unknown as ReturnType<typeof useWorkflowExecutionEventStream>);
  }

  it("the live stream reaching its terminal event refetches the snapshot once — the cards' full I/O and the header phase land without a reload", () => {
    const { refetch } = arrange(ExecutionPhase.EXECUTION_IN_PROGRESS);
    mockStreamStage("streaming");
    const { rerender } = render(<WorkflowExecutionViewer executionId="wex_1" />);
    expect(refetch).not.toHaveBeenCalled();

    // The stream delivers the terminal event → stage flips to complete.
    // (Benign prop change to get past the viewer's memo — in production the
    // store subscription re-renders the viewer without any prop change.)
    mockStreamStage("complete");
    rerender(
      <WorkflowExecutionViewer executionId="wex_1" className="pass-2" />,
    );
    expect(refetch).toHaveBeenCalledTimes(1);

    // Idempotent: staying complete never re-triggers.
    rerender(
      <WorkflowExecutionViewer executionId="wex_1" className="pass-3" />,
    );
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("a reconnecting stream that resolves straight to complete also refetches", () => {
    const { refetch } = arrange(ExecutionPhase.EXECUTION_IN_PROGRESS);
    mockStreamStage("reconnecting");
    const { rerender } = render(<WorkflowExecutionViewer executionId="wex_1" />);

    mockStreamStage("complete");
    rerender(
      <WorkflowExecutionViewer executionId="wex_1" className="pass-2" />,
    );

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("a terminal-replay mount (already complete, never streamed) does not refetch", () => {
    const { refetch } = arrange(ExecutionPhase.EXECUTION_COMPLETED);
    mockStreamStage("complete");
    render(<WorkflowExecutionViewer executionId="wex_1" />);

    expect(refetch).not.toHaveBeenCalled();
  });

  // The other stale direction (oss#571's live-run finding): a page that
  // lands BEFORE the run starts fetches a PENDING snapshot, and nothing
  // refetched it when the run began — the phase badge and the phase-gated
  // Pause/Cancel froze at "Pending" for the entire run. The store flips
  // connecting → streaming exactly when the FIRST event is delivered, so
  // that transition IS the "run started" signal.
  it("the stream's first delivery refetches a pending-landing snapshot — the phase badge and Pause/Cancel catch up to the started run", () => {
    const { refetch } = arrange(ExecutionPhase.EXECUTION_PENDING);
    mockStreamStage("connecting");
    const { rerender } = render(<WorkflowExecutionViewer executionId="wex_1" />);
    expect(refetch).not.toHaveBeenCalled();

    mockStreamStage("streaming");
    rerender(
      <WorkflowExecutionViewer executionId="wex_1" className="pass-2" />,
    );
    expect(refetch).toHaveBeenCalledTimes(1);

    // Idempotent: staying in streaming never re-triggers.
    rerender(
      <WorkflowExecutionViewer executionId="wex_1" className="pass-3" />,
    );
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("a reconnect recovery (reconnecting → streaming) refetches — the snapshot may have moved during the outage", () => {
    const { refetch } = arrange(ExecutionPhase.EXECUTION_IN_PROGRESS);
    mockStreamStage("streaming");
    const { rerender } = render(<WorkflowExecutionViewer executionId="wex_1" />);
    // Mid-run mount: the snapshot was just fetched — no refetch.
    expect(refetch).not.toHaveBeenCalled();

    mockStreamStage("reconnecting");
    rerender(
      <WorkflowExecutionViewer executionId="wex_1" className="pass-2" />,
    );
    expect(refetch).not.toHaveBeenCalled();

    mockStreamStage("streaming");
    rerender(
      <WorkflowExecutionViewer executionId="wex_1" className="pass-3" />,
    );
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

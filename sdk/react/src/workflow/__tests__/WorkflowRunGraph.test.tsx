/**
 * Pins WorkflowRunGraph's states and seams over a stubbed graph model and
 * React Flow canvas: the loading, error and empty ("No graph available for
 * this run") states; the graph model asked for the run it is given; the
 * active-task indicator shown only when following a run with an active
 * task, its follow toggle wired to the follow state machine; and the
 * one-shot initial fit, deferred while the container is hidden (0x0) and
 * run once it has a size.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Node } from "@xyflow/react";
import type { DerivedTaskState } from "../../internal/store/workflow-run-event-store";
import type { UseWorkflowRunGraphReturn } from "../useWorkflowRunGraph";
import { useWorkflowRunGraph } from "../useWorkflowRunGraph";
import type { UseFollowRunReturn } from "../useFollowRun";
import { useFollowRun } from "../useFollowRun";
import { WorkflowRunGraph } from "../WorkflowRunGraph";

const flow = vi.hoisted(() => ({ fitView: vi.fn() }));

// The canvas needs real layout to measure; its stub mounts the graph's
// children and reports the viewport ready, as React Flow's onInit does.
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  const { useEffect } = await import("react");
  return {
    ...actual,
    ReactFlow: ({
      onInit,
      nodes,
      children,
    }: {
      onInit?: () => void;
      nodes: readonly Node[];
      children?: ReactNode;
    }) => {
      useEffect(() => {
        onInit?.();
      }, [onInit]);
      return (
        <div data-testid="canvas-stub" data-node-count={nodes.length}>
          {children}
        </div>
      );
    },
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    useReactFlow: () => ({ fitView: flow.fitView }),
  };
});
vi.mock("../useWorkflowRunGraph", () => ({ useWorkflowRunGraph: vi.fn() }));
vi.mock("../useFollowRun", () => ({ useFollowRun: vi.fn() }));

const follow: UseFollowRunReturn = {
  followState: "following",
  isFollowing: true,
  enableFollow: vi.fn(),
  disableFollow: vi.fn(),
  handleMoveStart: vi.fn(),
};

function running(name: string): DerivedTaskState {
  return {
    taskName: name,
    status: "running",
    durationMs: 0,
    agentSlug: "",
    currentToolName: "",
  } as unknown as DerivedTaskState;
}

function graph(overrides: Partial<UseWorkflowRunGraphReturn> = {}): UseWorkflowRunGraphReturn {
  return {
    nodes: [{ id: "build", position: { x: 0, y: 0 }, data: {} }],
    edges: [],
    runPhase: undefined,
    isLoading: false,
    error: null,
    versionMismatch: null,
    versionResolutionFailed: false,
    taskStates: new Map([["build", running("build")]]),
    ...overrides,
  };
}

function sizeContainers(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(height);
}

beforeEach(() => {
  flow.fitView.mockClear();
  vi.mocked(useFollowRun).mockReturnValue(follow);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorkflowRunGraph", () => {
  it("asks the graph model for the run it is given", () => {
    vi.mocked(useWorkflowRunGraph).mockReturnValue(graph());
    const taskStates = new Map<string, DerivedTaskState>();
    render(<WorkflowRunGraph runId="wfr_1" run={null} taskStates={taskStates} nodesDraggable />);

    expect(vi.mocked(useWorkflowRunGraph)).toHaveBeenCalledWith({
      runId: "wfr_1",
      run: null,
      taskStates,
      nodesDraggable: true,
    });
    expect(screen.getByTestId("canvas-stub").getAttribute("data-node-count")).toBe("1");
  });

  it("shows the loading skeleton, the model's error, and the empty state", () => {
    vi.mocked(useWorkflowRunGraph).mockReturnValue(graph({ isLoading: true }));
    const { rerender } = render(<WorkflowRunGraph runId="wfr_1" />);
    expect(screen.queryByTestId("canvas-stub")).toBeNull();

    vi.mocked(useWorkflowRunGraph).mockReturnValue(graph({ error: "Workflow not found" }));
    rerender(<WorkflowRunGraph runId="wfr_1" className="pass-2" />);
    expect(screen.getByText("Workflow not found")).toBeTruthy();

    vi.mocked(useWorkflowRunGraph).mockReturnValue(graph({ nodes: [] }));
    rerender(<WorkflowRunGraph runId="wfr_1" className="pass-3" />);
    expect(screen.getByText("No graph available for this run")).toBeTruthy();
  });

  it("shows the active task while following the run, and its toggle stops following", () => {
    vi.mocked(useWorkflowRunGraph).mockReturnValue(graph({ versionMismatch: "Workflow changed since this run" }));
    render(<WorkflowRunGraph runId="wfr_1" followRun />);

    expect(screen.getByText("Running: build")).toBeTruthy();
    expect(screen.getByText("Workflow changed since this run")).toBeTruthy();
    expect(vi.mocked(useFollowRun)).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true, activeTaskName: "build", isTerminal: false }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop following active task" }));
    expect(follow.disableFollow).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Running: build"));
    expect(follow.enableFollow).toHaveBeenCalledTimes(1);
  });

  it("shows no active-task indicator when not following", () => {
    vi.mocked(useWorkflowRunGraph).mockReturnValue(graph());
    render(<WorkflowRunGraph runId="wfr_1" />);
    expect(screen.queryByText("Running: build")).toBeNull();
  });

  it("defers the initial fit while the container is hidden", () => {
    sizeContainers(0, 0);
    vi.mocked(useWorkflowRunGraph).mockReturnValue(graph());
    render(<WorkflowRunGraph runId="wfr_1" />);

    expect(screen.getByTestId("canvas-stub")).toBeTruthy();
    expect(flow.fitView).not.toHaveBeenCalled();
  });

  it("fits the graph once when the container has a size", () => {
    sizeContainers(800, 600);
    vi.mocked(useWorkflowRunGraph).mockReturnValue(graph());
    const { rerender } = render(<WorkflowRunGraph runId="wfr_1" />);

    expect(flow.fitView).toHaveBeenCalledTimes(1);
    expect(flow.fitView.mock.calls[0]![0]).toMatchObject({ padding: 0.15 });

    rerender(<WorkflowRunGraph runId="wfr_1" className="pass-2" />);
    expect(flow.fitView).toHaveBeenCalledTimes(1);
  });
});

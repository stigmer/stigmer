/**
 * Pins FailureAnalysisPanel: it renders nothing without a failed run,
 * groups failed runs by their failing task with the total in the header,
 * expands a group to list each failed run by name, hands the run id to
 * `onRunClick` on click and on Enter or Space, renders the instances as
 * plain rows without a handler, and folds groups past
 * `initialVisibleGroups` behind a "Show N more" button.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  WorkflowRunSchema,
  type WorkflowRun,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import {
  RunPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { FailureAnalysisPanel } from "../FailureAnalysisPanel";

function failedRun(id: string, name: string, taskName: string, error: string, completedAt: string): WorkflowRun {
  return create(WorkflowRunSchema, {
    metadata: { id, name },
    status: {
      phase: RunPhase.RUN_FAILED,
      completedAt,
      tasks: [{ taskName, status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED, error }],
    },
  });
}

const RUNS: readonly WorkflowRun[] = [
  failedRun("wfr-1", "nightly-1", "fetchData", "timeout", "2026-05-01T10:00:00Z"),
  failedRun("wfr-2", "nightly-2", "fetchData", "connection reset", "2026-05-02T10:00:00Z"),
  failedRun("wfr-3", "nightly-3", "publish", "denied", "2026-05-03T10:00:00Z"),
  create(WorkflowRunSchema, {
    metadata: { id: "wfr-4", name: "nightly-4" },
    status: { phase: RunPhase.RUN_COMPLETED },
  }),
];

describe("FailureAnalysisPanel", () => {
  afterEach(cleanup);

  it("renders nothing when no run failed", () => {
    const { container } = render(<FailureAnalysisPanel runs={[RUNS[3]!]} />);
    expect(container.innerHTML).toBe("");
  });

  it("groups failures by failing task, most frequent first, with the latest error", () => {
    render(<FailureAnalysisPanel runs={RUNS} />);
    expect(screen.getByRole("region", { name: "Failure analysis" })).toBeTruthy();
    expect(screen.getByText("3 failed")).toBeTruthy();
    const toggles = screen.getAllByRole("button", { expanded: false });
    expect(toggles.map((b) => b.textContent)).toEqual([
      "fetchDataconnection reset2",
      "publishdenied1",
    ]);
  });

  it("lists a group's failed runs when expanded and opens one by click, Enter or Space", () => {
    const onRunClick = vi.fn();
    render(<FailureAnalysisPanel runs={RUNS} onRunClick={onRunClick} />);

    fireEvent.click(screen.getByRole("button", { name: /fetchData/ }));
    // Most recent failure first; each row also carries its failure date.
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]!.textContent).toContain("nightly-2");
    expect(links[1]!.textContent).toContain("nightly-1");
    expect(links[0]!.querySelector("time")?.getAttribute("dateTime")).toBe("2026-05-02T10:00:00.000Z");

    fireEvent.click(links[0]!);
    expect(onRunClick).toHaveBeenLastCalledWith("wfr-2");
    fireEvent.keyDown(links[1]!, { key: "Enter" });
    expect(onRunClick).toHaveBeenLastCalledWith("wfr-1");
    fireEvent.keyDown(links[0]!, { key: " " });
    expect(onRunClick).toHaveBeenLastCalledWith("wfr-2");
    fireEvent.keyDown(links[0]!, { key: "a" });
    expect(onRunClick).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole("button", { name: /fetchData/ }));
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("renders a group's runs as plain rows when no onRunClick is given", () => {
    render(<FailureAnalysisPanel runs={RUNS} />);
    fireEvent.click(screen.getByRole("button", { name: /publish/ }));
    expect(screen.getByText("nightly-3")).toBeTruthy();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("folds groups past initialVisibleGroups behind a show-more button", () => {
    render(<FailureAnalysisPanel runs={RUNS} initialVisibleGroups={1} />);
    expect(screen.queryByRole("button", { name: /publish/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show 1 more failing task" }));
    expect(screen.getByRole("button", { name: /publish/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show .* more/ })).toBeNull();
  });
});

/**
 * Pins RunHistoryTable: the error, loading and empty states and their
 * copy, rows sorted newest first by default, a header click or Enter
 * switching the sort field (descending first) and a second press flipping
 * the direction, each row's cells (phase badge, duration, cost, task
 * progress, failed task), `visibleColumns` choosing the columns, and a row
 * handing its run id to `onRowClick` on click, Enter or Space.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import {
  RunPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { RunHistoryTable } from "../RunHistoryTable";
import { deriveRunRows, type RunRow } from "../derive-run-row";

const ROWS: readonly RunRow[] = deriveRunRows([
  create(WorkflowRunSchema, {
    metadata: { id: "wfr-a", name: "alpha" },
    status: {
      phase: RunPhase.RUN_FAILED,
      startedAt: "2026-05-01T10:00:00Z",
      completedAt: "2026-05-01T10:00:02Z",
      totalCostMicros: BigInt(250_000),
      tasks: [
        { taskName: "fetch", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED },
        { taskName: "publish", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED },
      ],
    },
  }),
  create(WorkflowRunSchema, {
    metadata: { id: "wfr-b", name: "bravo" },
    status: {
      phase: RunPhase.RUN_COMPLETED,
      startedAt: "2026-05-03T10:00:00Z",
      completedAt: "2026-05-03T10:01:30Z",
      totalInputTokens: BigInt(1_500),
    },
  }),
  create(WorkflowRunSchema, {
    metadata: { id: "wfr-c", name: "charlie" },
    status: { phase: RunPhase.RUN_COMPLETED, startedAt: "2026-05-02T10:00:00Z" },
  }),
]);

function bodyRowNames(): string[] {
  const table = screen.getByRole("table", { name: "Run history" });
  return within(table)
    .getAllByRole("link")
    .map((tr) => tr.querySelector("td")?.textContent ?? "");
}

describe("RunHistoryTable", () => {
  afterEach(cleanup);

  it("reports a load error with the error's message, or without one", () => {
    const { rerender } = render(<RunHistoryTable rows={ROWS} error={new Error("forbidden")} />);
    expect(screen.getByRole("alert").textContent).toBe("Failed to load runs: forbidden");
    rerender(<RunHistoryTable rows={ROWS} error={new Error("")} />);
    expect(screen.getByRole("alert").textContent).toBe("Failed to load runs");
  });

  it("shows a skeleton while loading and an empty state with no rows", () => {
    const { rerender } = render(<RunHistoryTable rows={[]} isLoading />);
    expect(screen.getByRole("table", { name: "Loading run history" })).toBeTruthy();
    rerender(<RunHistoryTable rows={[]} />);
    expect(screen.getByText("No runs yet")).toBeTruthy();
  });

  it("sorts newest first and re-sorts from the headers", () => {
    render(<RunHistoryTable rows={ROWS} onRowClick={vi.fn()} />);
    expect(bodyRowNames()).toEqual(["bravo", "charlie", "alpha"]);
    const started = screen.getByRole("columnheader", { name: /Started/ });
    expect(started.getAttribute("aria-sort")).toBe("descending");

    const name = screen.getByRole("columnheader", { name: /Name/ });
    fireEvent.click(name);
    expect(name.getAttribute("aria-sort")).toBe("descending");
    expect(started.getAttribute("aria-sort")).toBeNull();
    expect(bodyRowNames()).toEqual(["charlie", "bravo", "alpha"]);

    fireEvent.keyDown(name, { key: "Enter" });
    expect(name.getAttribute("aria-sort")).toBe("ascending");
    expect(bodyRowNames()).toEqual(["alpha", "bravo", "charlie"]);

    fireEvent.keyDown(name, { key: " " });
    expect(name.getAttribute("aria-sort")).toBe("descending");
    fireEvent.keyDown(name, { key: "x" });
    expect(name.getAttribute("aria-sort")).toBe("descending");
  });

  it("renders each row's phase, duration, cost, progress and failed task", () => {
    render(<RunHistoryTable rows={ROWS} onRowClick={vi.fn()} />);
    const alpha = screen.getAllByRole("link").find((tr) => tr.textContent?.includes("alpha"))!;
    const cells = within(alpha).getAllByRole("cell").map((td) => td.textContent);
    expect(within(alpha).getByLabelText("Failed")).toBeTruthy();
    expect(cells).toContain("2.0s");
    expect(cells).toContain("$0.25");
    // A failed task is finished, so both of alpha's tasks count.
    expect(cells).toContain("2/2");
    expect(cells).toContain("publish");

    const charlie = screen.getAllByRole("link").find((tr) => tr.textContent?.includes("charlie"))!;
    const charlieCells = within(charlie).getAllByRole("cell").map((td) => td.textContent);
    expect(charlieCells.filter((c) => c === "—")).toHaveLength(4);
  });

  it("shows only the requested columns", () => {
    render(<RunHistoryTable rows={ROWS} visibleColumns={["name", "tokens"]} />);
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Name", "Tokens"]);
    expect(screen.getByText("1.5K")).toBeTruthy();
  });

  it("opens a run from its row by click, Enter or Space", () => {
    const onRowClick = vi.fn();
    render(<RunHistoryTable rows={ROWS} onRowClick={onRowClick} />);
    const [bravo, charlie] = screen.getAllByRole("link");
    fireEvent.click(bravo!);
    expect(onRowClick).toHaveBeenLastCalledWith("wfr-b");
    fireEvent.keyDown(charlie!, { key: "Enter" });
    expect(onRowClick).toHaveBeenLastCalledWith("wfr-c");
    fireEvent.keyDown(bravo!, { key: " " });
    expect(onRowClick).toHaveBeenLastCalledWith("wfr-b");
    fireEvent.keyDown(bravo!, { key: "Tab" });
    expect(onRowClick).toHaveBeenCalledTimes(3);
  });

  it("renders rows that are not links without onRowClick", () => {
    render(<RunHistoryTable rows={ROWS} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("alpha")).toBeTruthy();
  });
});

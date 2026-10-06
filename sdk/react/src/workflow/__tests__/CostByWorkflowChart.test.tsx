/**
 * Pins CostByWorkflowChart: rows sorted by cost descending and capped at
 * eight, each with the workflow's name (its slug when unnamed), its cost
 * in the chart's money format, its run count, and a bar sized against the
 * costliest; the empty state and the busy skeleton.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { WorkflowCostBreakdownSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";
import { CostByWorkflowChart } from "../CostByWorkflowChart";

afterEach(cleanup);

function breakdown(slug: string, totalCostUsd: number, runCount: number, workflowName = "") {
  return create(WorkflowCostBreakdownSchema, {
    workflowSlug: slug,
    workflowName,
    totalCostUsd,
    runCount,
  });
}

describe("CostByWorkflowChart", () => {
  it("lists workflows by cost, costliest first, with cost, run count and relative bar", () => {
    render(
      <CostByWorkflowChart
        isLoading={false}
        breakdowns={[
          breakdown("cheap", 0.005, 1),
          breakdown("triage", 2, 7, "Nightly triage"),
          breakdown("mid", 0.05, 3),
          breakdown("free", 0, 2),
        ]}
      />,
    );

    const rows = within(screen.getByRole("list", { name: "Cost by workflow" })).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Nightly triage$2.007 runs",
      "mid$0.0503 runs",
      "cheap<$0.011 runs",
      "free$0.002 runs",
    ]);
    const firstBar = rows[0]!.querySelector("[style]") as HTMLElement;
    const secondBar = rows[1]!.querySelector("[style]") as HTMLElement;
    expect(firstBar.style.width).toBe("100%");
    expect(secondBar.style.width).toBe("2.5%");
  });

  it("shows at most eight workflows", () => {
    const many = Array.from({ length: 10 }, (_, i) => breakdown(`wf-${i}`, i + 1, 1));
    render(<CostByWorkflowChart isLoading={false} breakdowns={many} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    expect(screen.queryByText("wf-0")).toBeNull();
  });

  it("shows the empty state and the loading skeleton", () => {
    const { container, rerender } = render(
      <CostByWorkflowChart isLoading={false} breakdowns={[]} />,
    );
    expect(screen.getByText("No cost data available")).toBeTruthy();

    rerender(<CostByWorkflowChart isLoading breakdowns={[]} />);
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
  });
});

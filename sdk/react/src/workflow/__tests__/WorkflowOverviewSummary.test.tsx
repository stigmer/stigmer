/**
 * Pins WorkflowOverviewSummary's four stat cards (Total Runs, Success Rate,
 * Avg Duration, Total Cost) and their formats, the dash for an unknown
 * duration, the "No runs yet" empty state for no summary or zero runs, and
 * the skeleton while loading.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { RunSummarySchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";
import { WorkflowOverviewSummary } from "../WorkflowOverviewSummary";

afterEach(cleanup);

function cardValue(label: string): string | null {
  return screen.getByText(label).nextElementSibling?.textContent ?? null;
}

describe("WorkflowOverviewSummary", () => {
  it("shows the total, success rate, average duration and cost of the workflow's runs", () => {
    const summary = create(RunSummarySchema, {
      totalCount: 12,
      successRate: 0.75,
      avgDuration: { seconds: 3720n },
      totalCost: { totalCostUsd: 3.456 },
    });
    render(<WorkflowOverviewSummary summary={summary} isLoading={false} />);

    expect(cardValue("Total Runs")).toBe("12");
    expect(cardValue("Success Rate")).toBe("75%");
    expect(cardValue("Avg Duration")).toBe("1h 2m");
    expect(cardValue("Total Cost")).toBe("$3.46");
  });

  it("shows a dash and $0.00 when duration and cost are absent", () => {
    render(
      <WorkflowOverviewSummary
        summary={create(RunSummarySchema, { totalCount: 1, successRate: 1 })}
        isLoading={false}
      />,
    );
    expect(cardValue("Success Rate")).toBe("100%");
    expect(cardValue("Avg Duration")).toBe("—");
    expect(cardValue("Total Cost")).toBe("$0.00");
  });

  it("says no runs yet for no summary or a summary without runs", () => {
    const { rerender } = render(
      <WorkflowOverviewSummary summary={null} isLoading={false} />,
    );
    expect(screen.getByText("No runs yet")).toBeTruthy();

    rerender(
      <WorkflowOverviewSummary summary={create(RunSummarySchema, {})} isLoading={false} />,
    );
    expect(screen.getByText("No runs yet")).toBeTruthy();
    expect(screen.queryByText("Total Runs")).toBeNull();
  });

  it("shows four skeleton cards while loading", () => {
    const { container } = render(
      <WorkflowOverviewSummary summary={null} isLoading />,
    );
    expect(container.firstElementChild?.children).toHaveLength(4);
    expect(screen.queryByText("No runs yet")).toBeNull();
  });
});

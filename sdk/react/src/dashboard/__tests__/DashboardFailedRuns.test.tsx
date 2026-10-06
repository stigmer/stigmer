/**
 * DashboardFailedRuns: a skeleton while loading, the empty copy with no
 * failures, and one row per failed run with its kind badge (Agent or
 * Workflow), name, error, and a View button that hands back the run's id and
 * kind for routing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DashboardFailedRuns } from "../DashboardFailedRuns";
import type { DashboardFailedRun } from "../types";

afterEach(cleanup);

const failedAt = new Date(Date.now() - 5 * 60_000);

const runs: DashboardFailedRun[] = [
  { id: "aex_1", type: "agent_run", name: "Triage inbox", error: "model refused", failedAt, resourceName: "triage" },
  { id: "wex_1", type: "workflow_run", name: "Nightly build", error: "", failedAt, resourceName: "build" },
];

describe("DashboardFailedRuns", () => {
  it("shows a busy skeleton while loading", () => {
    const { container } = render(<DashboardFailedRuns failedRuns={[]} isLoading />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByText("Recent Failures")).toBeNull();
  });

  it("shows the empty copy when nothing failed", () => {
    render(<DashboardFailedRuns failedRuns={[]} isLoading={false} />);
    expect(screen.getByText("No recent failures")).toBeTruthy();
  });

  it("badges each run by kind and routes View with its id and kind", () => {
    const onViewClick = vi.fn();
    render(<DashboardFailedRuns failedRuns={runs} isLoading={false} onViewClick={onViewClick} />);

    const [agentRow, workflowRow] = screen.getAllByRole("listitem");
    expect(within(agentRow!).getByText("Agent")).toBeTruthy();
    expect(within(agentRow!).getByText("Triage inbox")).toBeTruthy();
    expect(within(agentRow!).getByText("model refused")).toBeTruthy();
    expect(within(workflowRow!).getByText("Workflow")).toBeTruthy();
    expect(within(workflowRow!).getByText("Nightly build")).toBeTruthy();

    fireEvent.click(within(workflowRow!).getByRole("button", { name: "View" }));
    expect(onViewClick).toHaveBeenCalledWith("wex_1", "workflow_run");
  });

  it("renders no View button without a handler", () => {
    render(<DashboardFailedRuns failedRuns={runs} isLoading={false} />);
    expect(screen.queryByRole("button", { name: "View" })).toBeNull();
  });
});

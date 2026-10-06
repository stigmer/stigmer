/**
 * DashboardFailedRuns: a skeleton while loading, the empty copy with no
 * failures, and one row per failed run with its name, error, and a View
 * button that hands back the run's id for routing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DashboardFailedRuns } from "../DashboardFailedRuns";
import type { DashboardFailedRun } from "../types";

afterEach(cleanup);

const failedAt = new Date(Date.now() - 5 * 60_000);

const runs: DashboardFailedRun[] = [
  { id: "aex_1", name: "Triage inbox", error: "model refused", failedAt, resourceName: "triage" },
  { id: "aex_2", name: "Nightly build", error: "", failedAt, resourceName: "build" },
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

  it("lists each run and routes View with its id", () => {
    const onViewClick = vi.fn();
    render(<DashboardFailedRuns failedRuns={runs} isLoading={false} onViewClick={onViewClick} />);

    const [firstRow, secondRow] = screen.getAllByRole("listitem");
    expect(within(firstRow!).getByText("Triage inbox")).toBeTruthy();
    expect(within(firstRow!).getByText("model refused")).toBeTruthy();
    expect(within(secondRow!).getByText("Nightly build")).toBeTruthy();

    fireEvent.click(within(secondRow!).getByRole("button", { name: "View" }));
    expect(onViewClick).toHaveBeenCalledWith("aex_2");
  });

  it("renders no View button without a handler", () => {
    render(<DashboardFailedRuns failedRuns={runs} isLoading={false} />);
    expect(screen.queryByRole("button", { name: "View" })).toBeNull();
  });
});

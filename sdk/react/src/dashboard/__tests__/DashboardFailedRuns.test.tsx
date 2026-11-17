/**
 * DashboardFailedRuns: its outline under its title while loading, the
 * empty line with no failures, a failed read said with Try again (never as
 * "No recent failures"), and one row per failed run with its name, error,
 * and a View button that hands back the run's id for routing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ConnectError, Code } from "@connectrpc/connect";
import { DashboardFailedRuns } from "../DashboardFailedRuns";
import type { DashboardFailedRun } from "../types";

afterEach(cleanup);

const failedAt = new Date(Date.now() - 5 * 60_000);

const runs: DashboardFailedRun[] = [
  { id: "run_1", name: "Triage inbox", error: "model refused", failedAt, resourceName: "triage" },
  { id: "run_2", name: "Nightly build", error: "", failedAt, resourceName: "build" },
];

describe("DashboardFailedRuns", () => {
  it("shows a busy skeleton while loading", () => {
    const { container } = render(<DashboardFailedRuns failedRuns={[]} isLoading />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Recent failures" })).toBeTruthy();
    expect(screen.queryByText("No recent failures.")).toBeNull();
  });

  it("shows the empty copy when nothing failed", () => {
    render(<DashboardFailedRuns failedRuns={[]} isLoading={false} />);
    expect(screen.getByText("No recent failures.")).toBeTruthy();
  });

  it("says a failed read with Try again, never that nothing failed", () => {
    const onRetry = vi.fn();
    render(
      <DashboardFailedRuns
        failedRuns={[]}
        isLoading={false}
        error={new ConnectError("the run service did not answer in time", Code.Unavailable)}
        onRetry={onRetry}
      />,
    );
    expect(screen.queryByText("No recent failures.")).toBeNull();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Couldn't load recent failures.");
    expect(alert.textContent).toContain("This week's figures above are unaffected.");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("lists each run and routes View with its id", () => {
    const onViewClick = vi.fn();
    render(<DashboardFailedRuns failedRuns={runs} isLoading={false} onViewClick={onViewClick} />);

    const [firstRow, secondRow] = screen.getAllByRole("listitem");
    expect(within(firstRow!).getByText("Triage inbox")).toBeTruthy();
    expect(within(firstRow!).getByText("model refused")).toBeTruthy();
    expect(within(secondRow!).getByText("Nightly build")).toBeTruthy();

    fireEvent.click(within(secondRow!).getByRole("button", { name: "View" }));
    expect(onViewClick).toHaveBeenCalledWith("run_2");
  });

  it("renders no View button without a handler", () => {
    render(<DashboardFailedRuns failedRuns={runs} isLoading={false} />);
    expect(screen.queryByRole("button", { name: "View" })).toBeNull();
  });
});

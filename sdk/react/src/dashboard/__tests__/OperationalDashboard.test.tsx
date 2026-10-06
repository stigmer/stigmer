/**
 * Pins the composed dashboard's wiring: both data hooks read the one
 * organization it was given, the KPI cards and the recent failures render
 * inside the labelled region, and a failed run's View hands its id to the
 * host. The two data hooks are stubbed; the cards and the failures list are
 * pinned in their own suites.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

const asked = vi.hoisted(() => ({ summary: [] as unknown[], failed: [] as unknown[] }));

vi.mock("../useDashboardSummary.js", () => ({
  useDashboardSummary: (options: { org: unknown }) => {
    asked.summary.push(options.org);
    return {
      summary: { activeCount: 1, completedCount: 3, failedCount: 1, totalCostUsd: 0, orgUsage: null },
      isLoading: false,
      error: null,
      refetch: () => {},
    };
  },
}));

vi.mock("../useDashboardFailedRuns.js", () => ({
  useDashboardFailedRuns: (org: unknown) => {
    asked.failed.push(org);
    return {
      failedRuns: [
        {
          id: "aex_9",
          name: "Nightly triage",
          error: "model refused",
          failedAt: new Date("2026-10-01T00:00:00Z"),
          resourceName: "triage-bot",
        },
      ],
      isLoading: false,
      error: null,
      refetch: () => {},
    };
  },
}));

import { OperationalDashboard } from "../OperationalDashboard";

describe("OperationalDashboard", () => {
  it("reads one organization and renders the cards and the failures in its region", () => {
    const onFailedRunClick = vi.fn();
    render(<OperationalDashboard org="acme" onFailedRunClick={onFailedRunClick} />);

    expect(asked.summary.at(-1)).toBe("acme");
    expect(asked.failed.at(-1)).toBe("acme");

    const region = screen.getByRole("region", { name: "Platform dashboard" });
    expect(within(region).getByText("Completed").nextElementSibling?.textContent).toBe("3");
    expect(within(region).getByText("Nightly triage")).toBeTruthy();

    fireEvent.click(within(region).getByRole("button", { name: "View" }));
    expect(onFailedRunClick).toHaveBeenCalledWith("aex_9");
  });
});

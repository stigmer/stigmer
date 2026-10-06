/**
 * Pins the web dashboard's wiring: the operational dashboard and the
 * workflow summary read the active organization by its id, the way the
 * server names every org, never by its slug; a pending approval and a
 * failed run picked on the dashboard each open that run through run
 * navigation, whatever kind of run it is. The dashboard widgets are pinned
 * in @stigmer/react.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import type { DashboardFailedRun } from "@stigmer/react";

const page = vi.hoisted(() => ({
  dashboard: [] as Array<Record<string, unknown>>,
  summaryOrg: [] as string[],
  openedRuns: [] as string[],
}));

vi.mock("@stigmer/react", () => ({
  useOrg: () => ({ activeOrg: { metadata: { id: "org_acme", slug: "acme" } } }),
  OperationalDashboard: (props: Record<string, unknown>) => {
    page.dashboard.push(props);
    return null;
  },
  CostByWorkflowChart: () => null,
  RunTrendChart: () => null,
  useWorkflowDashboardSummary: ({ org }: { org: string }) => {
    page.summaryOrg.push(org);
    return { summary: null, isLoading: false };
  },
}));

vi.mock("@/domain/workflow/run-navigation", () => ({
  useRunNavigation: () => ({ navigateToRun: (id: string) => page.openedRuns.push(id) }),
}));

import { DashboardPage } from "../DashboardPage";

beforeEach(() => {
  page.dashboard.length = 0;
  page.summaryOrg.length = 0;
  page.openedRuns.length = 0;
});

describe("web DashboardPage", () => {
  it("reads the active org by its id, not its slug", () => {
    render(<DashboardPage />);

    expect(page.dashboard.at(-1)?.org).toBe("org_acme");
    expect(page.summaryOrg.at(-1)).toBe("org_acme");
  });

  it("opens the run a pending approval belongs to", () => {
    render(<DashboardPage />);

    act(() => (page.dashboard.at(-1)?.onApprovalClick as (id: string) => void)("ar_waiting"));

    expect(page.openedRuns).toEqual(["ar_waiting"]);
  });

  it("opens a failed run the same way whatever its kind", () => {
    render(<DashboardPage />);
    const onFailedRunClick = page.dashboard.at(-1)?.onFailedRunClick as (
      id: string,
      type: DashboardFailedRun["type"],
    ) => void;

    act(() => onFailedRunClick("wfr_failed", "workflow_run"));
    act(() => onFailedRunClick("ar_failed", "agent_run"));

    expect(page.openedRuns).toEqual(["wfr_failed", "ar_failed"]);
  });
});

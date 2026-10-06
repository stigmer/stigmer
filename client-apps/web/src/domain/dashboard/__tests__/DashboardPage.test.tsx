/**
 * Pins the web dashboard's wiring: the operational dashboard and the
 * workflow summary read the active organization by its id, the way the
 * server names every org, never by its slug. The dashboard widgets are
 * pinned in @stigmer/react.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const page = vi.hoisted(() => ({
  dashboard: [] as Array<Record<string, unknown>>,
  summaryOrg: [] as string[],
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
  useRunNavigation: () => ({ navigateToRun: () => undefined }),
}));

import { DashboardPage } from "../DashboardPage";

beforeEach(() => {
  page.dashboard.length = 0;
  page.summaryOrg.length = 0;
});

describe("web DashboardPage", () => {
  it("reads the active org by its id, not its slug", () => {
    render(<DashboardPage />);

    expect(page.dashboard.at(-1)?.org).toBe("org_acme");
    expect(page.summaryOrg.at(-1)).toBe("org_acme");
  });
});

/**
 * Pins the web dashboard's wiring: the operational dashboard reads the
 * active organization by its id, the way the server names every org, never
 * by its slug; a failed run picked on the dashboard opens that run through
 * run navigation. The dashboard widgets are pinned in @stigmer/react.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";

const page = vi.hoisted(() => ({
  dashboard: [] as Array<Record<string, unknown>>,
  openedRuns: [] as string[],
}));

vi.mock("@stigmer/react", () => ({
  useOrg: () => ({ activeOrg: { metadata: { id: "org_acme", slug: "acme" } } }),
  OperationalDashboard: (props: Record<string, unknown>) => {
    page.dashboard.push(props);
    return null;
  },
}));

vi.mock("@/domain/runs/run-navigation", () => ({
  useRunNavigation: () => ({ navigateToRun: (id: string) => page.openedRuns.push(id) }),
}));

import { DashboardPage } from "../DashboardPage";

beforeEach(() => {
  page.dashboard.length = 0;
  page.openedRuns.length = 0;
});

describe("web DashboardPage", () => {
  it("reads the active org by its id, not its slug", () => {
    render(<DashboardPage />);

    expect(page.dashboard.at(-1)?.org).toBe("org_acme");
  });

  it("opens a failed run picked on the dashboard", () => {
    render(<DashboardPage />);

    act(() => (page.dashboard.at(-1)?.onFailedRunClick as (id: string) => void)("aex_failed"));

    expect(page.openedRuns).toEqual(["aex_failed"]);
  });
});

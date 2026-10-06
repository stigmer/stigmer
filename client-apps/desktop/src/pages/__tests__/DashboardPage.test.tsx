/**
 * Pins the desktop dashboard's navigation wiring: a pending approval and a
 * failed run, each picked on the SDK's operational dashboard, open that run's
 * page at /runs/<id>, whatever kind of run it is; and the dashboard reads the
 * active organization by id. The dashboard and its charts are pinned in
 * @stigmer/react; here they are stubbed to capture the props they are given.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { DashboardFailedRun } from "@stigmer/react";

interface DashboardProps {
  org: string;
  onApprovalClick: (runId: string) => void;
  onFailedRunClick: (runId: string, type: DashboardFailedRun["type"]) => void;
}

const page = vi.hoisted(() => ({
  dashboard: [] as DashboardProps[],
}));

vi.mock("@stigmer/react", () => ({
  useOrg: () => ({ activeOrg: { metadata: { id: "org_acme" } } }),
  useWorkflowDashboardSummary: () => ({ summary: undefined, isLoading: false }),
  OperationalDashboard: (props: DashboardProps) => {
    page.dashboard.push(props);
    return null;
  },
  CostByWorkflowChart: () => null,
  RunTrendChart: () => null,
}));

import DashboardPage from "../dashboard/DashboardPage";

function Location() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="*" element={null} />
      </Routes>
      <Location />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  page.dashboard.length = 0;
});

describe("desktop DashboardPage — opening a run", () => {
  it("reads the active organization by id", () => {
    renderDashboard();

    expect(page.dashboard.at(-1)?.org).toBe("org_acme");
  });

  it("opens the run a pending approval belongs to", () => {
    renderDashboard();

    act(() => page.dashboard.at(-1)?.onApprovalClick("ar_waiting"));

    expect(screen.getByTestId("location").textContent).toBe("/runs/ar_waiting");
  });

  it("opens a failed run at the same address whatever its kind", () => {
    renderDashboard();

    act(() => page.dashboard.at(-1)?.onFailedRunClick("wfr_failed", "workflow_run"));
    expect(screen.getByTestId("location").textContent).toBe("/runs/wfr_failed");

    act(() => page.dashboard.at(-1)?.onFailedRunClick("ar_failed", "agent_run"));
    expect(screen.getByTestId("location").textContent).toBe("/runs/ar_failed");
  });
});

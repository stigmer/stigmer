/**
 * Pins the desktop dashboard's navigation wiring: a failed run picked on the
 * SDK's operational dashboard opens that run's page at /runs/<id>; and the
 * dashboard reads the active organization by id. The dashboard is pinned in
 * @stigmer/react; here it is stubbed to capture the props it is given.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

interface DashboardProps {
  org: string;
  onFailedRunClick: (runId: string) => void;
}

const page = vi.hoisted(() => ({
  dashboard: [] as DashboardProps[],
}));

vi.mock("@stigmer/react", () => ({
  useOrg: () => ({ activeOrg: { metadata: { id: "org_acme" } } }),
  OperationalDashboard: (props: DashboardProps) => {
    page.dashboard.push(props);
    return null;
  },
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

  it("opens a failed run at its address", () => {
    renderDashboard();

    act(() => page.dashboard.at(-1)?.onFailedRunClick("aex_failed"));

    expect(screen.getByTestId("location").textContent).toBe("/runs/aex_failed");
  });
});

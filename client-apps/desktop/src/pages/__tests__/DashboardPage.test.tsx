/**
 * Pins the desktop dashboard's navigation wiring: a failed run picked on the
 * SDK's operational dashboard opens that run's page at /runs/<id>; the
 * dashboard reads the active organization by id; the page opens on the
 * kit's page heading; and a new organization's first steps lead to the
 * app's routes (the models hub, a new agent, the launcher) through the
 * router's own link, so the hash routes hold. The dashboard is pinned in
 * @stigmer/react-sdk; here it is stubbed to capture the props it is given.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

interface DashboardProps {
  org: string;
  onFailedRunClick: (runId: string) => void;
  firstStepLinks?: Record<string, string>;
  renderLink?: (link: { href: string; className: string; children: ReactNode }) => ReactNode;
}

const page = vi.hoisted(() => ({
  dashboard: [] as DashboardProps[],
}));

vi.mock("@stigmer/react-sdk", () => ({
  useOrg: () => ({ activeOrg: { metadata: { id: "org_acme" } } }),
  OperationalDashboard: (props: DashboardProps) => {
    page.dashboard.push(props);
    // Draws one first step with the host's link, as the kit does.
    return <>{props.renderLink?.({ href: "/models", className: "step", children: "Connect a provider" })}</>;
  },
  PageHeader: ({ title }: { title: ReactNode }) => <h1>{title}</h1>,
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

    act(() => page.dashboard.at(-1)?.onFailedRunClick("run_failed"));

    expect(screen.getByTestId("location").textContent).toBe("/runs/run_failed");
  });

  it("opens on the page heading", () => {
    renderDashboard();

    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy();
  });

  it("leads a new organization's first steps to the app's routes, through the router", () => {
    renderDashboard();

    expect(page.dashboard.at(-1)?.firstStepLinks).toEqual({
      connectProvider: "/models",
      createAgent: "/library/agents/new",
      startSession: "/",
    });
    fireEvent.click(screen.getByRole("link", { name: "Connect a provider" }));
    expect(screen.getByTestId("location").textContent).toBe("/models");
  });
});

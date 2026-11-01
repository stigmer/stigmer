/**
 * Pins the web dashboard's wiring: the operational dashboard reads the
 * active organization by its id, the way the server names every org, never
 * by its slug; a failed run picked on the dashboard opens that run through
 * run navigation; the page opens on the kit's page heading; and a new
 * organization's first steps lead to the console's routes (the models hub,
 * a new agent, the launcher), drawn with the console's link. The dashboard
 * widgets are pinned in @stigmer/react-sdk.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

const page = vi.hoisted(() => ({
  dashboard: [] as Array<Record<string, unknown>>,
  openedRuns: [] as string[],
}));

vi.mock("@stigmer/react-sdk", () => ({
  useOrg: () => ({ activeOrg: { metadata: { id: "org_acme", slug: "acme" } } }),
  OperationalDashboard: (props: Record<string, unknown>) => {
    page.dashboard.push(props);
    return null;
  },
  PageHeader: ({ title, description }: { title: ReactNode; description?: ReactNode }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  ),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children?: ReactNode; href: string; className?: string }) => (
    <a href={href} className={className} data-next-link="">
      {children}
    </a>
  ),
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

    act(() => (page.dashboard.at(-1)?.onFailedRunClick as (id: string) => void)("run_failed"));

    expect(page.openedRuns).toEqual(["run_failed"]);
  });

  it("opens on the page heading", () => {
    render(<DashboardPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy();
  });

  it("leads a new organization's first steps to the console's routes, drawn with its link", () => {
    render(<DashboardPage />);

    const props = page.dashboard.at(-1);
    expect(props?.firstStepLinks).toEqual({ connectProvider: "/models", createAgent: "/library/agents/new", startSession: "/" });
    const renderLink = props?.renderLink as (link: { href: string; className: string; children: ReactNode }) => ReactNode;
    render(<>{renderLink({ href: "/models", className: "step", children: "Connect a provider" })}</>);
    const link = screen.getByRole("link", { name: "Connect a provider" });
    expect(link.getAttribute("href")).toBe("/models");
    expect(link.hasAttribute("data-next-link")).toBe(true);
  });
});

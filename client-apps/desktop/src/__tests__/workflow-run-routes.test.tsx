/**
 * Pins the desktop router's run addresses: /library/workflows/runs renders the
 * workflow run list, and /runs/<id> (where the dashboard, the sidebar and the
 * run list send a person) renders the run's page. Each page loads lazily, so
 * the test renders the matched route's element and waits for the page; the
 * pages themselves are stubbed and pinned by their own suites.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, matchRoutes } from "react-router-dom";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/plugin-deep-link", () => ({ onOpenUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(false),
  requestPermission: vi.fn().mockResolvedValue("denied"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ exit: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ listen: vi.fn().mockResolvedValue(() => {}) })),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn().mockResolvedValue(null) }));

vi.mock("../pages/workflow/WorkflowRunListPage", () => ({
  default: () => <p>workflow run list</p>,
}));
vi.mock("../pages/workflow/WorkflowRunDetailPage", () => ({
  default: () => <p>workflow run page</p>,
}));

import { router } from "../routes";

function renderRoute(path: string): void {
  const leaf = (matchRoutes(router.routes, path) ?? []).at(-1)?.route;
  expect(leaf, `no desktop route matches ${path}`).toBeDefined();
  render(<MemoryRouter initialEntries={[path]}>{leaf?.element}</MemoryRouter>);
}

describe("desktop routes — run addresses", () => {
  it("renders the workflow run list at /library/workflows/runs", async () => {
    renderRoute("/library/workflows/runs");

    expect(await screen.findByText("workflow run list")).toBeTruthy();
  });

  it("renders a run's page at /runs/<id>", async () => {
    renderRoute("/runs/wfr_1");

    expect(await screen.findByText("workflow run page")).toBeTruthy();
  });
});

/**
 * Pins the desktop router's run address: /runs/<id> (where the dashboard
 * and a schedule's runs send a person) renders the run page. The page loads
 * lazily, so the test renders the matched route's element and waits for
 * the page; the page itself is stubbed and pinned by its own suite. The
 * route saved at the last launch is reopened only while the app still
 * routes it, so a saved address the app no longer routes opens the home
 * screen.
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

vi.mock("../pages/runs/RunPage", () => ({
  default: () => <p>run page</p>,
}));

import { restorableRoute, router } from "../routes";

function renderRoute(path: string): void {
  const leaf = (matchRoutes(router.routes, path) ?? []).at(-1)?.route;
  expect(leaf, `no desktop route matches ${path}`).toBeDefined();
  render(<MemoryRouter initialEntries={[path]}>{leaf?.element}</MemoryRouter>);
}

describe("desktop routes — the run address", () => {
  it("renders the run page at /runs/<id>", async () => {
    renderRoute("/runs/aex_1");

    expect(await screen.findByText("run page")).toBeTruthy();
  });
});

describe("desktop routes — the route reopened at launch", () => {
  it("reopens a saved route the app still routes", () => {
    expect(restorableRoute("/runs/aex_1")).toBe("/runs/aex_1");
    expect(restorableRoute("/sessions/ses_1")).toBe("/sessions/ses_1");
  });

  it("opens the home screen for a saved route the app no longer routes", () => {
    expect(restorableRoute("/executions/aex_1")).toBeUndefined();
    expect(restorableRoute("/no-such-screen")).toBeUndefined();
  });

  it("opens the home screen when nothing, or home, was saved", () => {
    expect(restorableRoute(null)).toBeUndefined();
    expect(restorableRoute("/")).toBeUndefined();
  });
});

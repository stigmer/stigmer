/**
 * Pins the desktop router's Models & providers address: /models (where the
 * sidebar and every "Models & providers" link send a person) renders the
 * React SDK's ModelsHub for the active organization, and nothing until one
 * is active. The page loads lazily, so the test renders the matched route's
 * element and waits for the hub; the hub itself is stubbed and pinned by
 * its own suite in sdk/react, so a route that drifted to another page, or a
 * page that handed the hub another organization, shows here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, matchRoutes } from "react-router-dom";

const page = vi.hoisted(() => ({ org: "org_acme" as string | null }));

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

vi.mock("@stigmer/react-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stigmer/react-sdk")>()),
  useActiveOrgId: () => page.org,
  ModelsHub: ({ org }: { org: string }) => <p>{`models hub for ${org}`}</p>,
}));

import { router } from "../routes";

function renderModelsRoute() {
  const path = "/models";
  const leaf = (matchRoutes(router.routes, path) ?? []).at(-1)?.route;
  expect(leaf?.path, `no desktop route matches ${path}`).toBe("models");
  return render(<MemoryRouter initialEntries={[path]}>{leaf?.element}</MemoryRouter>);
}

beforeEach(() => {
  page.org = "org_acme";
});

describe("desktop routes — the Models & providers address", () => {
  it("renders the models hub for the active organization at /models", async () => {
    renderModelsRoute();

    expect(await screen.findByText("models hub for org_acme")).toBeTruthy();
  });

  it("renders nothing until an organization is active", async () => {
    page.org = null;
    const { container } = renderModelsRoute();

    // The lazy page has loaded once its spinner is gone.
    await vi.waitFor(() => expect(container.querySelector(".animate-spin")).toBeNull());
    expect(screen.queryByText(/models hub/)).toBeNull();
    expect(container.textContent).toBe("");
  });
});

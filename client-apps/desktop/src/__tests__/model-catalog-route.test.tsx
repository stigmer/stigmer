/**
 * Pins the desktop router's model catalog address: /settings/model-catalog
 * (where the operator-gated Platform nav group sends a platform operator)
 * renders the React SDK's ModelCatalogConsole. The page loads lazily, so the
 * test renders the matched route's element and waits for the console; the
 * console itself is stubbed and pinned by its own suite in sdk/react, so a
 * route that drifted to another page, or a page that rendered another
 * console, shows here.
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

vi.mock("@stigmer/react-sdk/console", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stigmer/react-sdk/console")>()),
  ModelCatalogConsole: () => <p>model catalog console</p>,
}));

import { router } from "../routes";

describe("desktop routes — the model catalog address", () => {
  it("renders the model catalog console at /settings/model-catalog", async () => {
    const path = "/settings/model-catalog";
    const leaf = (matchRoutes(router.routes, path) ?? []).at(-1)?.route;
    expect(leaf?.path, `no desktop route matches ${path}`).toBe("model-catalog");

    render(<MemoryRouter initialEntries={[path]}>{leaf?.element}</MemoryRouter>);

    expect(await screen.findByText("model catalog console")).toBeTruthy();
  });
});

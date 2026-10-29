/**
 * Pins the desktop router's organization profile address: /settings/org-profile
 * renders the React SDK's OrgProfileSection through a lazy page that lands on
 * the dashboard when a child organization is opened from the section, as an
 * organization switch from the sidebar does. The section itself is stubbed
 * and pinned by its own suites in sdk/react.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, matchRoutes } from "react-router-dom";
import type { OrgProfileSectionProps } from "@stigmer/react-sdk/console";

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
  OrgProfileSection: ({ onOrgChanged }: OrgProfileSectionProps) => (
    <button type="button" onClick={() => onOrgChanged?.({} as never)}>
      open a child
    </button>
  ),
}));

import { router } from "../routes";

describe("desktop routes — the organization profile address", () => {
  it("renders the section at /settings/org-profile, and an opened child lands on the dashboard", async () => {
    const path = "/settings/org-profile";
    const leaf = (matchRoutes(router.routes, path) ?? []).at(-1)?.route;
    expect(leaf?.path, `no desktop route matches ${path}`).toBe("org-profile");

    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path} element={leaf?.element} />
          <Route path="/dashboard" element={<p>dashboard</p>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "open a child" }));

    expect(await screen.findByText("dashboard")).toBeTruthy();
  });
});

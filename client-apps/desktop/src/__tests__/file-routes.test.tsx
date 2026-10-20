/**
 * Pins the desktop router's Files address: /library/files resolves to a
 * route whose lazy page loads and renders the Library's File list, and no
 * route exists under it, since a File has no page of its own (a row opens
 * its preview). The SDK's list is stubbed and pinned by its own suites in
 * sdk/react.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, matchRoutes } from "react-router-dom";

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
  ResourceWorkbench: ({ "aria-label": label }: { "aria-label"?: string }) => <p>{label}</p>,
  ApplyManifestDialog: () => null,
  FileUploadButton: () => <button type="button">Upload</button>,
  useStigmer: () => ({}),
  useActiveOrgId: () => "org_acme",
  useCanCreateFile: () => ({ allowed: true, isLoading: false }),
  useOrgSlugForId: () => (id: string) => id,
  useBreadcrumbOverride: () => ({ setLabel: () => undefined }),
}));

import { router } from "../routes";

describe("desktop routes — the Files address", () => {
  it("renders the list at /library/files", async () => {
    const leaf = (matchRoutes(router.routes, "/library/files") ?? []).at(-1)?.route;
    expect(leaf, "no desktop route matches /library/files").toBeDefined();
    render(
      <MemoryRouter initialEntries={["/library/files"]}>
        <Routes>
          <Route path="/library/files" element={leaf?.element} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("File workbench")).toBeTruthy();
  });

  it("has no File detail route: a File opens in its preview", () => {
    const leaf = (matchRoutes(router.routes, "/library/files/acme/file_01") ?? []).at(-1)?.route;
    expect(leaf?.path ?? "").not.toMatch(/^files\//);
  });
});

/**
 * Pins the desktop router's Environment addresses: /library/environments,
 * /library/environments/new and /library/environments/:org/:slug each
 * resolve to a route whose lazy page loads and renders the SDK's
 * Environment list, form and detail view for the address it names. The SDK
 * views are stubbed and pinned by their own suites in sdk/react; the pages'
 * wiring is pinned in pages/__tests__/EnvironmentPages.test.tsx.
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
  EnvironmentsNotOnServerNotice: () => null,
  EnvironmentForm: ({ org }: { org: string }) => <p>new environment form in {org}</p>,
  EnvironmentDetailView: ({ org, slug }: { org: string; slug: string }) => (
    <p>
      environment {org}/{slug}
    </p>
  ),
  useStigmer: () => ({}),
  useActiveOrgId: () => "org_acme",
  useCanCreateEnvironment: () => ({ allowed: true, isLoading: false }),
  useOrgSlugForId: () => (id: string) => id,
  useBreadcrumbOverride: () => ({ setLabel: () => undefined }),
}));

import { router } from "../routes";

/** Renders the leaf route the desktop router matches for `path`, at that path. */
function renderRoute(path: string, routePath: string) {
  const leaf = (matchRoutes(router.routes, path) ?? []).at(-1)?.route;
  expect(leaf, `no desktop route matches ${path}`).toBeDefined();
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={leaf?.element} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("desktop routes — the Environment addresses", () => {
  it("renders the list at /library/environments", async () => {
    renderRoute("/library/environments", "/library/environments");
    expect(await screen.findByText("Environment workbench")).toBeTruthy();
  });

  it("renders the form at /library/environments/new, in the active organization", async () => {
    renderRoute("/library/environments/new", "/library/environments/new");
    expect(await screen.findByText("new environment form in org_acme")).toBeTruthy();
  });

  it("renders the detail view the address names", async () => {
    renderRoute("/library/environments/acme/data-science", "/library/environments/:org/:slug");
    expect(await screen.findByText("environment acme/data-science")).toBeTruthy();
  });
});

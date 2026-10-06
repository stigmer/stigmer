/**
 * Pins that the desktop pages scoped to the active organization (the
 * dashboard and the session launcher) ask the server by the organization's
 * minted id, never its slug: the slug can be renamed, the id cannot, and the
 * server keys every scoped query by id. The views and data hooks are pinned
 * in @stigmer/react.
 */
import type { ComponentType } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const { ACME, page, record } = vi.hoisted(() => {
  const page = { orgs: {} as Record<string, unknown[]> };
  return {
    ACME: { id: "org_01jaaaaaaaaaaaaaaaaaaaaaaa", slug: "acme" },
    page,
    record(name: string, org: unknown): void {
      (page.orgs[name] ??= []).push(org);
    },
  };
});

vi.mock("@stigmer/react", () => ({
  useActiveOrgId: () => ACME.id,
  useOrg: () => ({ activeOrg: { metadata: { id: ACME.id, slug: ACME.slug } } }),
  OperationalDashboard: ({ org }: { org: string }) => {
    record("OperationalDashboard", org);
    return null;
  },
  NewSessionViewer: ({ org }: { org: string }) => {
    record("NewSessionViewer", org);
    return null;
  },
  useAccountExecutionDefaults: () => undefined,
  useWorkspaceSources: () => ({ enableGitHub: false, enableLocal: true }),
}));

vi.mock("../../hooks/useNativeFolderPicker", () => ({ useNativeFolderPicker: () => undefined }));
vi.mock("../../hooks/useNativeWorkspaceFiles", () => ({ useNativeWorkspaceFiles: () => undefined }));
vi.mock("../../hooks/useNativeWorkspaceFileReader", () => ({ useNativeWorkspaceFileReader: () => undefined }));
vi.mock("../../hooks/useNativeWorkspaceContentSearcher", () => ({
  useNativeWorkspaceContentSearcher: () => undefined,
}));

import DashboardPage from "../dashboard/DashboardPage";
import { SessionLauncher } from "../SessionLauncher";

function renderPage(Page: ComponentType): void {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="*" element={<Page />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  page.orgs = {};
});

describe("desktop pages scoped to the active organization", () => {
  it("the dashboard asks for its operational view by org id", () => {
    renderPage(DashboardPage);

    expect(page.orgs.OperationalDashboard?.at(-1)).toBe(ACME.id);
  });

  it("the session launcher creates sessions in the org by id", () => {
    renderPage(SessionLauncher);

    expect(page.orgs.NewSessionViewer?.at(-1)).toBe(ACME.id);
  });
});

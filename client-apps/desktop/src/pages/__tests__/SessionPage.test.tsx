/**
 * Pins the desktop session page's wiring (stigmer/stigmer#1580): the page
 * reads the session its route names and hands it to
 * useFollowSessionOrganization, so the shell follows a conversation opened
 * from another organization, and the viewer and the share dialog act in
 * the active organization the hook aligns. The hook's own behaviour is
 * pinned in @stigmer/react.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const page = vi.hoisted(() => ({
  followed: [] as unknown[],
  viewer: [] as Array<Record<string, unknown>>,
  access: [] as Array<Record<string, unknown>>,
}));

const SESSION = { metadata: { id: "ses_1", org: "acme" } };

vi.mock("@stigmer/react", () => ({
  SessionViewer: (props: Record<string, unknown>) => {
    page.viewer.push(props);
    return <>{props.accessSlot as React.ReactNode}</>;
  },
  ManageAccessButton: (props: Record<string, unknown>) => {
    page.access.push(props);
    return null;
  },
  ThreadSkeleton: () => null,
  useSession: (id: string) => ({ session: id === "ses_1" ? SESSION : null }),
  useFollowSessionOrganization: (session: unknown) => {
    page.followed.push(session);
  },
  useActiveOrgSlug: () => "acme",
  useActiveOrgId: () => "acme",
  useAccountExecutionDefaults: () => undefined,
  useWorkspaceSources: () => ({ enableGitHub: false, enableLocal: true }),
}));

vi.mock("../../hooks/useNativeFolderPicker", () => ({
  useNativeFolderPicker: () => undefined,
}));
vi.mock("../../hooks/useNativeWorkspaceFiles", () => ({
  useNativeWorkspaceFiles: () => undefined,
}));
vi.mock("../../hooks/useNativeWorkspaceFileReader", () => ({
  useNativeWorkspaceFileReader: () => undefined,
}));
vi.mock("../../hooks/useNativeWorkspaceContentSearcher", () => ({
  useNativeWorkspaceContentSearcher: () => undefined,
}));

import SessionPage from "../SessionPage";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sessions/:id" element={<SessionPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  page.followed.length = 0;
  page.viewer.length = 0;
  page.access.length = 0;
  cleanup();
});

describe("desktop SessionPage", () => {
  it("hands the session its route names to useFollowSessionOrganization", () => {
    renderAt("/sessions/ses_1");

    expect(page.followed).toContain(SESSION);
  });

  it("gives the viewer and the share dialog the active organization", () => {
    renderAt("/sessions/ses_1");

    expect(page.viewer.at(-1)?.org).toBe("acme");
    expect((page.access.at(-1)?.resource as { org: string }).org).toBe("acme");
  });
});

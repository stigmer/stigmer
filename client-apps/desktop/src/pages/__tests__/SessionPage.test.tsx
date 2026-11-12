/**
 * Pins the desktop session page's wiring (stigmer/stigmer#1580): the page
 * reads the session its route names and hands it to
 * useFollowSessionOrganization, so the shell follows a conversation opened
 * from another organization, and the viewer and the share dialog act in
 * the active organization the hook aligns; the share button is offered only
 * where a session can be shared with people (not the open-source edition);
 * and the viewer's next step is the journey's line, for the session's agent
 * in the active organization, with the app's routes.
 * The hook's own behaviour is
 * pinned in @stigmer/react-sdk.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const page = vi.hoisted(() => ({
  next: [] as Array<Record<string, unknown>>,
  followed: [] as unknown[],
  viewer: [] as Array<Record<string, unknown>>,
  access: [] as Array<Record<string, unknown>>,
  mode: "cloud" as string,
}));

const SESSION = { metadata: { id: "ses_1", org: "org_acme" } };

vi.mock("@stigmer/react-sdk", () => ({
  SessionInspector: () => null,
  JourneyNextLine: (props: Record<string, unknown>) => {
    page.next.push(props);
    return null;
  },
  useOrgSlugForId: () => (id: string) => (id === "org_acme" ? "acme" : id),
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
  useActiveOrgId: () => "org_acme",
  useAccountExecutionDefaults: () => undefined,
  useWorkspaceSources: () => ({ enableGitHub: false, enableLocal: true }),
  useDeploymentMode: () => page.mode,
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
  page.mode = "cloud";
  cleanup();
});

describe("desktop SessionPage", () => {
  it("draws the journey's next line as the viewer's next step, for the session's agent", () => {
    renderAt("/sessions/ses_1");
    const nextStep = page.viewer.at(-1)?.nextStep as (session: { agentRef: { org: string; slug: string } }) => React.ReactElement;
    render(nextStep({ agentRef: { org: "org_acme", slug: "variance-reporter" } }));

    const line = page.next.at(-1) as { org: string; agentRef: unknown; links: { makeItYours: (agent: { org: string; slug: string }) => string } };
    expect(line.org).toBe(page.viewer.at(-1)?.org);
    expect(line.agentRef).toEqual({ org: "org_acme", slug: "variance-reporter" });
    expect(line.links.makeItYours({ org: "org_acme", slug: "variance-reporter" })).toBe("/library/agents/acme/variance-reporter?tab=make-it-yours");
  });

  it("offers no Manage access on the open-source edition, where a session is shared with no one", () => {
    page.mode = "local";
    renderAt("/sessions/ses_1");

    expect(page.viewer.at(-1)?.accessSlot).toBeUndefined();
    expect(page.access).toHaveLength(0);
  });

  it("hands the session its route names to useFollowSessionOrganization", () => {
    renderAt("/sessions/ses_1");

    expect(page.followed).toContain(SESSION);
  });

  it("gives the viewer and the share dialog the active organization", () => {
    renderAt("/sessions/ses_1");

    expect(page.viewer.at(-1)?.org).toBe("org_acme");
    expect((page.access.at(-1)?.resource as { org: string }).org).toBe("org_acme");
  });

  it("turns on the builder mode, links Models & providers and a routine through the hash router", () => {
    renderAt("/sessions/ses_1");

    const props = page.viewer.at(-1)!;
    expect(props.inspector).toBeDefined();
    expect(props.modelsHubHref).toBe("#/models");
    const routineHref = props.routineHref as (routine: { metadata: { org: string; slug: string } }) => string;
    expect(routineHref({ metadata: { org: "org_acme", slug: "nightly" } })).toBe("#/library/routines/acme/nightly");
  });
});

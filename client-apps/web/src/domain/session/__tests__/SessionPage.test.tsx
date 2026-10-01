/**
 * Pins the web session page's wiring (stigmer/stigmer#1580): the page
 * reads the session it shows and hands it to useFollowSessionOrganization,
 * so the shell follows a conversation opened from another organization,
 * and the viewer, the share dialog and the GitHub connection act in the
 * active organization the hook aligns. The hook's own behaviour is pinned
 * in @stigmer/react.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

const page = vi.hoisted(() => ({
  followed: [] as unknown[],
  viewer: [] as Array<Record<string, unknown>>,
  access: [] as Array<Record<string, unknown>>,
  github: [] as string[],
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
  useGitHubConnection: (org: string) => {
    page.github.push(org);
    return { token: null };
  },
  useGitHubTreeLister: () => undefined,
  useGitHubFileReader: () => undefined,
  useWorkspaceSources: () => ({ enableGitHub: true, enableLocal: false }),
}));

vi.mock("@/domain/_shared/hooks/useStaticRouteParam", () => ({
  useStaticRouteParam: () => "ses_1",
}));

import { SessionPageInner } from "../SessionPage";

beforeEach(() => {
  page.followed.length = 0;
  page.viewer.length = 0;
  page.access.length = 0;
  page.github.length = 0;
  cleanup();
});

describe("web SessionPage", () => {
  it("hands the session it shows to useFollowSessionOrganization", () => {
    render(<SessionPageInner id="ses_1" />);

    expect(page.followed).toContain(SESSION);
  });

  it("gives the viewer, the share dialog and the GitHub connection the active organization", () => {
    render(<SessionPageInner id="ses_1" />);

    expect(page.viewer.at(-1)?.org).toBe("acme");
    expect((page.access.at(-1)?.resource as { org: string }).org).toBe("acme");
    expect(page.github).toContain("acme");
  });
});

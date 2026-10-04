/**
 * Pins the web session launcher's wiring: a new session starts in the
 * active organization by its id, the way the server names every org, and
 * the GitHub connection is the one that org holds; an `?agent=org/slug`
 * deep link preselects that agent, and the link a detail page builds with
 * `getAgentSessionUrl` is one the launcher reads back to the same agent.
 * The viewer is pinned in @stigmer/react.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const page = vi.hoisted(() => ({
  viewer: [] as Array<Record<string, unknown>>,
  github: [] as Array<string | null>,
  search: new URLSearchParams(),
}));

vi.mock("@stigmer/react", () => ({
  NewSessionViewer: (props: Record<string, unknown>) => {
    page.viewer.push(props);
    return null;
  },
  useActiveOrgId: () => "org_acme",
  useAccountExecutionDefaults: () => undefined,
  useGitHubConnection: (org: string | null) => {
    page.github.push(org);
    return { token: null };
  },
  useGitHubTreeLister: () => undefined,
  useGitHubFileReader: () => undefined,
  useWorkspaceSources: () => ({ enableGitHub: true, enableLocal: false }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => page.search,
}));

vi.mock("@/domain/session/session-navigation", () => ({
  useSessionNavigation: () => ({ navigateToSession: () => undefined }),
}));

import { SessionLauncher } from "../SessionLauncher";
import { getAgentSessionUrl } from "../session-url";

beforeEach(() => {
  page.viewer.length = 0;
  page.github.length = 0;
  page.search = new URLSearchParams();
});

describe("web SessionLauncher", () => {
  it("starts the session and reads GitHub in the active org by its id", () => {
    render(<SessionLauncher />);

    expect(page.viewer.at(-1)?.org).toBe("org_acme");
    expect(page.github).toContain("org_acme");
  });

  it("preselects the agent an ?agent=org/slug link names, and starts on the agent itself", () => {
    // An older link's instance parameter is ignored: there is no instance
    // to bind; the conversation starts on the agent.
    page.search = new URLSearchParams("agent=acme/helper&instance=ain_1");
    render(<SessionLauncher />);

    expect(page.viewer.at(-1)).toMatchObject({
      initialAgentRef: { org: "acme", slug: "helper" },
    });
    expect(page.viewer.at(-1)).not.toHaveProperty("initialInstanceId");
  });

  it("reads the link a detail page builds back to the same agent", () => {
    const link = new URL(
      getAgentSessionUrl("acme", "code-reviewer"),
      "https://console.test",
    );
    page.search = link.searchParams;
    render(<SessionLauncher />);

    expect(link.pathname).toBe("/");
    expect(page.viewer.at(-1)).toMatchObject({
      initialAgentRef: { org: "acme", slug: "code-reviewer" },
    });
  });
});

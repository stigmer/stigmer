/**
 * Pins the web session launcher's wiring: a new session starts in the
 * active organization by its id, the way the server names every org, and
 * the GitHub connection is the one that org holds; an `?agent=org/slug`
 * deep link preselects that agent, and the link a detail page builds with
 * `getAgentSessionUrl` is one the launcher reads back to the same agent; the
 * link `getPluginChatUrl` builds starts a chat with no agent that lists the
 * plugin; a link that arrives after the launcher is open is read too, and
 * the address is cleaned once read; the person's plugin picks are
 * remembered; and a refusal for want of a provider key raises no toast (the
 * launcher's own notice says it) while any other refusal does.
 * The viewer, and how a refusal is read, are pinned in @stigmer/react-sdk.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const page = vi.hoisted(() => ({
  viewer: [] as Array<Record<string, unknown>>,
  github: [] as Array<string | null>,
  search: new URLSearchParams(),
  toasts: [] as string[],
  keyRefusal: new Error("This organization has no Anthropic key, so the run was not started."),
}));

vi.mock("@stigmer/react-sdk", () => ({
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
  // The SDK reads the refusal's reason; here one error stands for a
  // provider-key refusal and every other is not one.
  providerKeyRequired: (error: unknown) =>
    error === page.keyRefusal ? { org: "acme", provider: "anthropic", model: "" } : null,
}));

vi.mock("sonner", () => ({
  toast: {
    error: (message: string) => {
      page.toasts.push(message);
    },
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => page.search,
}));

vi.mock("@/domain/session/session-navigation", () => ({
  useSessionNavigation: () => ({ navigateToSession: () => undefined }),
}));

import { SessionLauncher } from "../SessionLauncher";
import { getAgentSessionUrl, getPluginChatUrl } from "../session-url";

beforeEach(() => {
  page.viewer.length = 0;
  page.github.length = 0;
  page.search = new URLSearchParams();
  page.toasts.length = 0;
});

/** The viewer's error callback, as the launcher hands it. */
function onError(): (message: string, error: Error) => void {
  return page.viewer.at(-1)?.onError as (message: string, error: Error) => void;
}

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

  it("starts a chat with no agent that lists the plugin a plugin page's link names", () => {
    const link = new URL(getPluginChatUrl("acme", "linear"), "https://console.test");
    page.search = link.searchParams;
    render(<SessionLauncher />);

    expect(link.pathname).toBe("/");
    expect(page.viewer.at(-1)).toMatchObject({
      initialPluginRefs: [{ org: "acme", slug: "linear" }],
      initialAgentRef: undefined,
    });
  });

  it("reads an agent and a plugin link that arrive after the launcher opened, and cleans the address", () => {
    const replaced = vi.spyOn(window.history, "replaceState");
    const { rerender } = render(<SessionLauncher />);
    expect(replaced).not.toHaveBeenCalled();

    page.search = new URLSearchParams("agent=acme/helper&plugin=acme/linear");
    rerender(<SessionLauncher />);

    expect(page.viewer.at(-1)).toMatchObject({
      initialAgentRef: { org: "acme", slug: "helper" },
      initialPluginRefs: [{ org: "acme", slug: "linear" }],
    });
    expect(replaced).toHaveBeenCalledWith({}, "", "/");
    replaced.mockRestore();
  });

  it("remembers the person's plugin picks for the next conversation", () => {
    render(<SessionLauncher />);

    expect(page.viewer.at(-1)).toMatchObject({ rememberPluginPicks: true, initialPluginRefs: undefined });
  });

  it("raises no toast for a refusal for want of a provider key, which the launcher's notice says", () => {
    render(<SessionLauncher />);

    onError()(page.keyRefusal.message, page.keyRefusal);

    expect(page.toasts).toEqual([]);
  });

  it("raises a toast for any other refusal", () => {
    render(<SessionLauncher />);

    onError()("The server is unreachable.", new Error("The server is unreachable."));

    expect(page.toasts).toEqual(["The server is unreachable."]);
  });
});

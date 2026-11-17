/**
 * Pins the web session launcher's wiring: a new session starts in the
 * active organization by its id, the way the server names every org, and
 * the GitHub connection is the one that org holds; an `?agent=org/slug`
 * deep link preselects that agent, and the link a detail page builds with
 * `getAgentSessionUrl` is one the launcher reads back to the same agent; the
 * link `getPluginChatUrl` builds starts a chat with no agent that lists the
 * plugin; a link that arrives after the launcher is open is read too, and
 * the address is cleaned once read; the person's plugin picks are
 * remembered; a newcomer's first question is turned on, with the journey's
 * routes for its next line; a launch link the agent page's "Make it yours"
 * tab builds (`getAgentLaunchUrl`, read by the kit's `useLinkedLaunch`) is
 * handed over as a launch, never as a deep-linked agent, and the address is
 * cleaned; and a refusal for want of a provider key raises no toast (the
 * launcher's own notice says it) while any other refusal does.
 * A teammate who has just joined through an invite link (stigmer#3208) is
 * welcomed above the heading in the organization they joined, with the
 * team's newest agents as links that open the launcher on each; the
 * welcome is read from this tab's storage, is forgotten once a conversation
 * starts (a reload then greets no more), stands aside while a link sends
 * the person somewhere, is never shown in another organization or without
 * the entry, and storage that throws breaks nothing.
 * The viewer, and how a refusal is read, are pinned in @stigmer/react-sdk.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";

const page = vi.hoisted(() => ({
  viewer: [] as Array<Record<string, unknown>>,
  github: [] as Array<string | null>,
  search: new URLSearchParams(),
  toasts: [] as string[],
  keyRefusal: new Error("This organization has no Anthropic key, so the run was not started."),
  navigated: [] as string[],
  agentLists: [] as Array<{ org: string | null; pageSize: number | undefined }>,
  agents: [] as Array<{ id: string; name: string; slug: string; org: string }>,
}));

vi.mock("@stigmer/react-sdk", () => ({
  SessionInspector: () => null,
  NewSessionViewer: (props: Record<string, unknown>) => {
    page.viewer.push(props);
    return <>{props.headerContent as ReactNode}</>;
  },
  useActiveOrgId: () => "org_acme",
  useOrg: () => ({ activeOrg: { metadata: { id: "org_acme", slug: "acme", name: "Acme Books" } } }),
  useOrgSlugForId: () => (id: string) => (id === "org_acme" ? "acme" : id),
  useAgentList: (org: string | null, options?: { pageSize?: number }) => {
    page.agentLists.push({ org, pageSize: options?.pageSize });
    return { agents: page.agents };
  },
  LinkButton: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  useAccountExecutionDefaults: () => undefined,
  useGitHubConnection: (org: string | null) => {
    page.github.push(org);
    return { token: null };
  },
  useGitHubTreeLister: () => undefined,
  useGitHubFileReader: () => undefined,
  useWorkspaceSources: () => ({ enableGitHub: true, enableLocal: false }),
  // The kit's launch reader, as its own suite pins it: a launch for a link with `with=`.
  useLinkedLaunch: (params: { agent: string | null; example: string | null; with: string | null }) =>
    params.with ? { key: `${params.agent}|${params.example}|${params.with}`, agentRef: params.agent } : undefined,
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

const JOURNEY_LINKS = vi.hoisted(() => ({ makeItYours: () => "/library/agents/acme/variance-reporter?tab=make-it-yours" }));
vi.mock("@/domain/journey/journey-links", () => ({
  useJourneyLinks: () => JOURNEY_LINKS,
  renderJourneyLink: () => null,
}));

vi.mock("@/domain/session/session-navigation", () => ({
  useSessionNavigation: () => ({
    navigateToSession: (sessionId: string) => {
      page.navigated.push(sessionId);
    },
  }),
}));

import { SessionLauncher } from "../SessionLauncher";
import { getAgentLaunchUrl, getAgentSessionUrl, getPluginChatUrl } from "../session-url";

beforeEach(() => {
  page.viewer.length = 0;
  page.github.length = 0;
  page.search = new URLSearchParams();
  page.toasts.length = 0;
  page.navigated.length = 0;
  page.agentLists.length = 0;
  page.agents = [];
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Storage holding `entries` that refuses every access (`"all"`, a blocked
 * origin) or only removal (`"removal"`).
 */
function refusingStorage(entries: Record<string, string>, refuses: "all" | "removal"): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const refuse = () => {
    throw new DOMException("storage disabled", "SecurityError");
  };
  return {
    getItem: (key) => (refuses === "all" ? refuse() : (entries[key] ?? null)),
    setItem: refuse,
    removeItem: refuse,
  };
}

const JOINED_ORG_KEY = "stigmer:invite:joined";

/** What the invite page leaves for the launcher once the person has joined `org`. */
function joined(org: string): void {
  sessionStorage.setItem(JOINED_ORG_KEY, JSON.stringify({ org }));
}

function agent(slug: string, name: string) {
  return { id: `agt_${slug}`, name, slug, org: "org_acme" };
}

const welcome = () => screen.queryByRole("region", { name: "Joined Acme Books" });

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

  it("asks a newcomer's first question, which the viewer skips for a deep-linked agent, with the journey's routes", () => {
    render(<SessionLauncher />);

    expect(page.viewer.at(-1)).toMatchObject({ firstQuestion: true, initialAgentRef: undefined, journeyLinks: JOURNEY_LINKS });
  });

  it("hands a Make it yours link over as a launch, not as a deep-linked agent, and cleans the address", () => {
    const replaced = vi.spyOn(window.history, "replaceState");
    page.search = new URLSearchParams(getAgentLaunchUrl("acme", "variance-reporter", { example: "variance-report", mode: "own" }).slice(2));
    render(<SessionLauncher />);

    expect(page.viewer.at(-1)).toMatchObject({
      launch: { key: "acme/variance-reporter|variance-report|own", agentRef: "acme/variance-reporter" },
      initialAgentRef: undefined,
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

  describe("the welcome for a teammate who has just joined", () => {
    it("names the organization joined and links the team's newest agents, a handful of them, to the launcher", () => {
      page.agents = [
        agent("variance-reporter", "Variance Reporter"),
        agent("close-checklist", "Close Checklist"),
        agent("vendor-triage", "Vendor Triage"),
        agent("receipts", "Receipts"),
        agent("payroll-check", "Payroll Check"),
      ];
      joined("org_acme");
      render(<SessionLauncher />);

      const region = welcome();
      expect(region).not.toBeNull();
      expect(region?.textContent).toContain("You\u2019ve joined Acme Books. Start with one of the team\u2019s agents:");
      expect(page.agentLists.at(-1)).toEqual({ org: "org_acme", pageSize: 4 });
      const links = within(region as HTMLElement).getAllByRole("link");
      expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
        ["Variance Reporter", getAgentSessionUrl("acme", "variance-reporter")],
        ["Close Checklist", getAgentSessionUrl("acme", "close-checklist")],
        ["Vendor Triage", getAgentSessionUrl("acme", "vendor-triage")],
        ["Receipts", getAgentSessionUrl("acme", "receipts")],
      ]);
      expect(links[0]?.getAttribute("href")).toBe("/?agent=acme%2Fvariance-reporter");
    });

    it("says only the joined line when no agent is visible", () => {
      joined("org_acme");
      render(<SessionLauncher />);

      expect(welcome()?.textContent).toBe("You\u2019ve joined Acme Books.");
      expect(within(welcome() as HTMLElement).queryAllByRole("link")).toEqual([]);
    });

    it("is forgotten once a conversation starts, which still opens, so a reload greets no more", () => {
      joined("org_acme");
      const first = render(<SessionLauncher />);
      expect(welcome()).not.toBeNull();

      act(() => {
        (page.viewer.at(-1)?.onSessionCreated as (sessionId: string) => void)("ses_1");
      });

      expect(page.navigated).toEqual(["ses_1"]);
      expect(welcome()).toBeNull();
      expect(page.viewer.at(-1)?.headerContent).toBeUndefined();
      expect(sessionStorage.getItem(JOINED_ORG_KEY)).toBeNull();

      first.unmount();
      render(<SessionLauncher />);
      expect(welcome()).toBeNull();
    });

    it("holds in this tab until a conversation starts", () => {
      joined("org_acme");
      const first = render(<SessionLauncher />);
      first.unmount();
      render(<SessionLauncher />);

      expect(welcome()).not.toBeNull();
    });

    it("goes once a link sends the person to an agent, one of its own included", () => {
      joined("org_acme");
      const { rerender } = render(<SessionLauncher />);
      expect(welcome()).not.toBeNull();

      page.search = new URLSearchParams("agent=acme/variance-reporter");
      rerender(<SessionLauncher />);

      expect(page.viewer.at(-1)).toMatchObject({ initialAgentRef: { org: "acme", slug: "variance-reporter" } });
      expect(welcome()).toBeNull();
    });

    it("is absent without the entry", () => {
      render(<SessionLauncher />);

      expect(welcome()).toBeNull();
      expect(page.viewer.at(-1)?.headerContent).toBeUndefined();
      expect(page.agentLists).toEqual([]);
    });

    it("is absent in another organization than the one joined", () => {
      joined("org_other");
      render(<SessionLauncher />);

      expect(welcome()).toBeNull();
    });

    it("is absent, and the launcher still opens, when storage throws", () => {
      vi.stubGlobal("sessionStorage", refusingStorage({ "stigmer:invite:joined": JSON.stringify({ org: "org_acme" }) }, "all"));
      render(<SessionLauncher />);

      expect(page.viewer.at(-1)?.org).toBe("org_acme");
      expect(welcome()).toBeNull();
    });

    it("still opens the conversation when storage cannot forget the entry", () => {
      vi.stubGlobal("sessionStorage", refusingStorage({ "stigmer:invite:joined": JSON.stringify({ org: "org_acme" }) }, "removal"));
      render(<SessionLauncher />);
      expect(welcome()).not.toBeNull();

      act(() => {
        (page.viewer.at(-1)?.onSessionCreated as (sessionId: string) => void)("ses_1");
      });

      expect(page.navigated).toEqual(["ses_1"]);
    });

    it("is absent for an entry it cannot read", () => {
      sessionStorage.setItem(JOINED_ORG_KEY, "not json");
      render(<SessionLauncher />);

      expect(welcome()).toBeNull();
    });
  });
});

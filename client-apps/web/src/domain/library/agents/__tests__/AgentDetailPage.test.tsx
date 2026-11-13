/**
 * Pins the web agent page's address after a rename: the agent the view
 * reads by the URL's slug answers its current one, reported on each load,
 * so a URL naming a slug the agent was renamed away from moves to the
 * current slug in place, and a rename made from the view moves it too.
 * Pins that the page holds no copy of the agent: the view owns the actions
 * that read it (`yamlActions`), and the page passes only Copy ID, Copy slug
 * and Delete (stigmer/stigmer#2813). Also pins what the page hands the view's
 * Channels tab: no tab of its own (the view builds Channels), the chat-link
 * URL builder, the channel-apps settings route and the session route, and
 * no external connect hand-off (the browser runs the Slack popup itself);
 * the journey's routes for the view's "Make it yours" tab; and the tab a
 * `?tab=` link names, read again once the address holds it.
 * The detail view itself is pinned in @stigmer/react-sdk; here it is stubbed to
 * capture its props.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";

interface ViewProps {
  onResourceLoad?: (meta: { name: string; id: string; slug: string }) => void;
  onRenamed?: (agent: Agent) => void;
  yamlActions?: boolean;
  actions?: Array<{ id: string }>;
  additionalTabs?: unknown;
  buildChatLinkUrl?: (channelId: string) => string;
  channelAppsHref?: string;
  sessionHref?: (sessionId: string) => string;
  onConnectExternal?: unknown;
  makeItYours?: unknown;
  inApp?: unknown;
  activeTab?: string;
}

const page = vi.hoisted(() => ({
  view: [] as ViewProps[],
  canonical: [] as string[],
}));

vi.mock("@stigmer/react-sdk", () => ({
  AgentDetailView: (props: ViewProps) => {
    page.view.push(props);
    return null;
  },
  ConfirmDialog: () => null,
  useCopyResource: () => ({ copyId: () => {}, copyQualifiedSlug: () => {} }),
  useConfirmAction: () => ({
    confirmState: null,
    confirm: () => {},
    handleConfirm: () => {},
    handleCancel: () => {},
  }),
  useDeleteResource: () => ({
    deleteResource: async () => {},
    isDeleting: false,
  }),
  useBreadcrumbOverride: () => ({ setLabel: () => {} }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));

vi.mock("@/domain/library/library-navigation", () => ({
  useLibraryNavigation: () => ({
    navigateToDetail: () => {},
    canonicalSlug: (slug: string) => page.canonical.push(slug),
  }),
  useRouteDetailYieldsToOverlay: () => false,
}));

const JOURNEY_LINKS = vi.hoisted(() => ({ launch: () => "/?with=own" }));
vi.mock("@/domain/journey/journey-links", () => ({
  useJourneyLinks: () => JOURNEY_LINKS,
}));

vi.mock("@/domain/runs/run-navigation", () => ({
  useRunNavigation: () => ({ navigateToRun: () => {} }),
}));

import { AgentDetailPageInner } from "../AgentDetailPage";
import { chatLinkUrlFor } from "@/domain/chat-link/chat-link-url";

beforeEach(() => {
  page.view.length = 0;
  page.canonical.length = 0;
});

/** The view's report of a load of the agent, answering `slug`. */
function loaded(slug: string): void {
  act(() => page.view.at(-1)?.onResourceLoad?.({ name: "Support bot", id: "agt_1", slug }));
}

describe("web AgentDetailPageInner", () => {
  it("leaves the address alone while the agent answers the URL's slug", () => {
    render(<AgentDetailPageInner org="acme" slug="support-bot" />);
    loaded("support-bot");

    expect(page.canonical).toEqual([]);
  });

  it("moves the address to the slug the agent answers to now, and to the one a rename gave it", () => {
    render(<AgentDetailPageInner org="acme" slug="test-bot" />);
    loaded("support-bot");
    expect(page.canonical).toEqual(["support-bot"]);

    act(() =>
      page.view
        .at(-1)
        ?.onRenamed?.({ metadata: { slug: "help-bot" } } as Agent),
    );
    act(() =>
      page.view.at(-1)?.onRenamed?.({ metadata: { slug: "" } } as Agent),
    );

    expect(page.canonical).toEqual(["support-bot", "help-bot"]);
  });

  it("moves the address to the slug a YAML apply renamed the agent to, reported by the view's next load", () => {
    render(<AgentDetailPageInner org="acme" slug="support-bot" />);
    loaded("support-bot");
    loaded("help-desk");

    expect(page.canonical).toEqual(["help-desk"]);
  });

  it("leaves the actions that read the agent to the view, and passes only its own", () => {
    render(<AgentDetailPageInner org="acme" slug="support-bot" />);

    const view = page.view.at(-1);
    expect(view?.yamlActions).toBe(true);
    expect(view?.actions?.map((a) => a.id)).toEqual(["copy-id", "copy-slug", "delete"]);
  });

  it("hands the view's Channels tab its routing seams and adds no tab of its own", () => {
    render(<AgentDetailPageInner org="acme" slug="support-bot" />);

    const view = page.view.at(-1);
    expect(view?.additionalTabs).toBeUndefined();
    expect(view?.buildChatLinkUrl).toBe(chatLinkUrlFor);
    expect(view?.channelAppsHref).toBe("/settings/channel-apps");
    expect(view?.sessionHref?.("ses_9")).toBe("/sessions/ses_9");
    // The browser runs Slack's OAuth popup in-app; only a webview host
    // hands it off.
    expect(view?.onConnectExternal).toBeUndefined();
  });

  it("moves to the tab a client-side link names once the address holds it, and keeps a tab picked since", () => {
    // A client-side arrival: the first render runs before the address moves.
    window.history.replaceState({}, "", "/sessions/ses_9");
    const { rerender } = render(<AgentDetailPageInner org="acme" slug="variance-reporter" />);
    expect(page.view.at(-1)?.activeTab).toBe("overview");

    window.history.replaceState({}, "", "/library/agents/acme/variance-reporter?tab=make-it-yours");
    rerender(<AgentDetailPageInner org="acme" slug="variance-reporter" />);
    expect(page.view.at(-1)?.activeTab).toBe("make-it-yours");

    act(() => (page.view.at(-1) as { onTabChange: (tab: string) => void }).onTabChange("versions"));
    rerender(<AgentDetailPageInner org="acme" slug="variance-reporter" />);
    expect(page.view.at(-1)?.activeTab).toBe("versions");
    window.history.replaceState({}, "", "/");
  });

  it("offers the view's Make it yours tab with the journey's routes, and opens the tab a link names", () => {
    window.history.replaceState({}, "", "/library/agents/acme/variance-reporter?tab=make-it-yours");
    render(<AgentDetailPageInner org="acme" slug="variance-reporter" />);

    const view = page.view.at(-1);
    expect(view?.makeItYours).toBe(JOURNEY_LINKS);
    expect(view?.activeTab).toBe("make-it-yours");
    window.history.replaceState({}, "", "/");
  });

  it("offers the view's In your app tab with the console's settings routes, and opens it from the journey's link", () => {
    window.history.replaceState({}, "", "/library/agents/acme/variance-reporter?tab=in-app");
    render(<AgentDetailPageInner org="acme" slug="variance-reporter" />);

    const view = page.view.at(-1);
    expect(view?.inApp).toBe(JOURNEY_LINKS);
    expect(view?.activeTab).toBe("in-app");
    window.history.replaceState({}, "", "/");
  });
});

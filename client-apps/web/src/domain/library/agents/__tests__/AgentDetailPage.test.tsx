/**
 * Pins the web agent page's address after a rename: the agent read by the
 * URL's slug answers its current one, so a URL naming a slug the agent was
 * renamed away from moves to the current slug in place, and a rename made
 * from the view moves it too. Also pins what the page hands the view's
 * Channels tab: no tab of its own (the view builds Channels), the chat-link
 * URL builder, the channel-apps settings route and the session route, and
 * no external connect hand-off (the browser runs the Slack popup itself).
 * The detail view itself is pinned in @stigmer/react-sdk; here it is stubbed to
 * capture its props.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";

interface ViewProps {
  onRenamed?: (agent: Agent) => void;
  additionalTabs?: unknown;
  buildChatLinkUrl?: (channelId: string) => string;
  channelAppsHref?: string;
  sessionHref?: (sessionId: string) => string;
  onConnectExternal?: unknown;
}

const page = vi.hoisted(() => ({
  view: [] as ViewProps[],
  canonical: [] as string[],
  agentSlug: "",
}));

vi.mock("@stigmer/react-sdk", () => ({
  AgentDetailView: (props: ViewProps) => {
    page.view.push(props);
    return null;
  },
  EditResourceYamlDialog: () => null,
  ConfirmDialog: () => null,
  useAgent: () => ({
    agent:
      page.agentSlug === "" ? null : { metadata: { slug: page.agentSlug } },
    refetch: () => {},
  }),
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
  useExportResource: () => ({
    copyYaml: () => {},
    copyJson: () => {},
    downloadYaml: () => {},
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

vi.mock("@/domain/runs/run-navigation", () => ({
  useRunNavigation: () => ({ navigateToRun: () => {} }),
}));

import { AgentDetailPageInner } from "../AgentDetailPage";
import { chatLinkUrlFor } from "@/domain/chat-link/chat-link-url";

beforeEach(() => {
  page.view.length = 0;
  page.canonical.length = 0;
  page.agentSlug = "";
});

describe("web AgentDetailPageInner", () => {
  it("leaves the address alone while the agent answers the URL's slug", () => {
    page.agentSlug = "support-bot";
    render(<AgentDetailPageInner org="acme" slug="support-bot" />);

    expect(page.canonical).toEqual([]);
  });

  it("moves the address to the slug the agent answers to now, and to the one a rename gave it", () => {
    page.agentSlug = "support-bot";
    render(<AgentDetailPageInner org="acme" slug="test-bot" />);
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

  it("hands the view's Channels tab its routing seams and adds no tab of its own", () => {
    page.agentSlug = "support-bot";
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
});

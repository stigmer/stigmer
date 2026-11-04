// The channel pages' screens (docs/guides/channels/): the variance
// reporter's Channels tab holding its chat link, its Slack workspace and its
// WhatsApp number, as the console's agent page draws it, and the dialogs the
// pages' steps open from it. The acts in the catalogue open each dialog the
// way the page's reader does.
//
// The chat link is the chat link page's own (its permanent ID, open to
// anyone, embeddable on the embed page's site); the Slack workspace and the
// WhatsApp business carry the organization's name, which no page prints.
import type { ConnectRouter } from "@connectrpc/connect";
import { ChannelQueryController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/query_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { ChannelAppQueryController } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/query_pb";
import { AgentDetailView, VisitorChat } from "@stigmer/react-sdk";
import { CHAT_LINK, LEDGER_KEYS, META_APP, SLACK_CHANNEL, VARIANCE_REPORTER, VARIANCE_REPORTER_VERSIONS, WHATSAPP_CHANNEL } from "../docs-fixtures.ts";
import { ORGANIZATION } from "../fixtures.ts";
import { agentRoutes, MENU, START_SESSION } from "./agent.tsx";
import type { Drawing } from "./drawing.ts";
import { productWindow } from "./story.tsx";

/** The address the console gives a chat link: the hosted chat page at its permanent ID. */
const chatLinkUrl = (channelId: string): string => `https://app.stigmer.ai/chat/${channelId}`;

/**
 * The variance reporter's Channels tab, as its owner, an admin, sees it:
 * with its three channels once the pages' steps are done, or with only its
 * chat link before Slack and WhatsApp are connected.
 */
export function agentChannelsScene(connected: "all" | "chat-link"): Drawing {
  const page = agentRoutes("owner", {
    agent: VARIANCE_REPORTER,
    versions: VARIANCE_REPORTER_VERSIONS,
    channels: connected === "all" ? [CHAT_LINK, SLACK_CHANNEL, WHATSAPP_CHANNEL] : [CHAT_LINK],
    vaults: [LEDGER_KEYS],
  });
  return {
    inOrganization: true,
    routes: (router: ConnectRouter) => {
      page(router);
      router.service(ChannelAppQueryController, { list: () => ({ entries: [META_APP] }) });
    },
    render: () => (
      <div style={{ maxWidth: "56rem", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <AgentDetailView
          org={ORGANIZATION.metadata?.slug ?? ""}
          slug={VARIANCE_REPORTER.metadata?.slug ?? ""}
          editable
          primaryAction={START_SESSION}
          actions={MENU}
          defaultTab="channels"
          buildChatLinkUrl={chatLinkUrl}
          channelAppsHref="/settings/channel-apps"
        />
      </div>
    ),
  };
}

/**
 * The embed page's widget on a host site: the hosted chat page is the kit's
 * `VisitorChat` on the page's plain ground (client-apps/web's
 * `ChatLinkPage`), and `<stigmer-agent>` frames that page at 400×600 by
 * default, so this draws the visitor's pixels, here on a plain help page of
 * the site the chat link lets embed it.
 */
export function embedWidgetScene(): Drawing {
  const reporter = VARIANCE_REPORTER.metadata;
  return {
    routes: (router: ConnectRouter) => {
      router.service(PlatformQueryController, { getServerInfo: () => ({}) });
      router.service(ChannelQueryController, {
        getAgentProfile: () => ({
          org: ORGANIZATION.metadata?.slug ?? "",
          slug: reporter?.slug ?? "",
          name: reporter?.name ?? "",
          description: VARIANCE_REPORTER.spec?.description ?? "",
          agentRef: CHAT_LINK.spec?.agentRef,
        }),
      });
    },
    render: () =>
      productWindow(
        <div style={{ display: "flex", gap: 32, padding: 32, background: "var(--stgm-muted)", minHeight: 664 }}>
          <div style={{ flex: 1, display: "grid", alignContent: "start", gap: 12, color: "var(--stgm-foreground)" }}>
            <div style={{ fontSize: 13, color: "var(--stgm-muted-foreground)" }}>acme.com/help</div>
            <div style={{ fontSize: 24, fontWeight: 600 }}>Help with your books</div>
            <p style={{ margin: 0, maxWidth: 420, lineHeight: 1.6, color: "var(--stgm-muted-foreground)" }}>
              Ask our assistant about your ledger, your budget or last quarter&apos;s variances. It answers from your own books.
            </p>
          </div>
          <div style={{ width: 400, height: 600, borderRadius: 12, overflow: "hidden", boxShadow: "0 0 0 1px var(--stgm-border)", background: "var(--stgm-background)" }}>
            <VisitorChat channelId={CHAT_LINK.metadata?.id ?? ""} />
          </div>
        </div>,
      ),
  };
}

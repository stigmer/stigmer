// The take-over page's screens (docs/guides/channels/take-over-conversations.mdx):
// the console's Conversations area over the variance reporter's WhatsApp
// number, as an admin sees it.
//
// Two businesses talk to the number, the homepage story's customers
// (brand/job-story.ts), since the page names none: Northwind Books asked
// for a person and the Agent escalated, so its conversation wants a human;
// Fernhill Bakery's question the Agent answered. Taken over, Ada holds
// Northwind's conversation, Northwind has written again, and the platform
// has sent its one acknowledgment while she types her reply.
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ConnectRouter } from "@connectrpc/connect";
import { ChannelQueryController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/query_pb";
import { ChannelConversationQueryController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/conversation_query_pb";
import {
  ChannelConversationSchema,
  ConversationControl,
  ConversationItemAuthor,
  ConversationLane,
  ConversationTimelineItemSchema,
  type ChannelConversation,
  type ConversationTimelineItem,
} from "@stigmer/apis/ai/stigmer/agentic/channel/v1/conversation_io_pb";
import { ChannelReceiptState, ChannelOutboundOrigin } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/outbound_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { IdentityAccountQueryController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/query_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { ConversationsWorkbench, type ConversationIdentity } from "@stigmer/react-sdk";
import { samples, sampleDate } from "@stigmer/react-sdk/test";
import { useState, type ReactElement } from "react";
import { JOB, OTHERS } from "../../../../brand/job-story.ts";
import { TAKE_OVER_EXAMPLE } from "../docs-examples.ts";
import { WHATSAPP_CHANNEL } from "../docs-fixtures.ts";
import { ACCOUNT, ORGANIZATION } from "../fixtures.ts";
import type { Drawing } from "./drawing.ts";

const MINUTE_MS = 60_000;
const ORG_ID = ORGANIZATION.metadata?.id ?? "";
const CHANNEL_ID = WHATSAPP_CHANNEL.metadata?.id ?? "";
const at = (minutesAgo: number) => timestampFromDate(sampleDate(-minutesAgo * MINUTE_MS));

/** Who holds Northwind's conversation: the Agent, which escalated it, or Ada, who took it over. */
type Holder = "agent" | "ada";

function northwind(holder: Holder): ChannelConversation {
  return create(ChannelConversationSchema, {
    channelId: CHANNEL_ID,
    conversationKey: "15550100142",
    org: ORG_ID,
    displayName: JOB.customer,
    control: holder === "agent" ? ConversationControl.control_agent : ConversationControl.control_human,
    controlledBy: holder === "ada" ? ACCOUNT.metadata?.id ?? "" : "",
    controlChangedAt: at(holder === "ada" ? 3 : 12),
    needsAttention: holder === "agent",
    attentionReason: holder === "agent" ? "The customer asked to talk to a person about their quarter's budget." : "",
    attentionChangedAt: at(12),
    lastCustomerMessageAt: at(holder === "ada" ? 2 : 13),
    lastActivityAt: at(holder === "ada" ? 2 : 12),
    awaitingReply: holder === "ada",
  });
}

const FERNHILL: ChannelConversation = create(ChannelConversationSchema, {
  channelId: CHANNEL_ID,
  conversationKey: "15550100178",
  org: ORG_ID,
  displayName: OTHERS.customer,
  control: ConversationControl.control_agent,
  lastCustomerMessageAt: at(41),
  lastActivityAt: at(40),
});

function item(id: string, author: ConversationItemAuthor, text: string, minutesAgo: number, authoredBy = ""): ConversationTimelineItem {
  const outbound = author !== ConversationItemAuthor.author_customer;
  return create(ConversationTimelineItemSchema, {
    itemId: id,
    lane: ConversationLane.lane_public,
    author,
    authoredBy,
    text,
    at: at(minutesAgo),
    ...(outbound ? { receiptState: ChannelReceiptState.receipt_delivered, origin: ChannelOutboundOrigin.channel_conversation } : {}),
  });
}

/** Northwind's conversation as the customer's phone shows it. */
function northwindTimeline(holder: Holder): ConversationTimelineItem[] {
  const { author_customer: customer, author_agent: agent, author_platform: platform } = ConversationItemAuthor;
  const items = [
    item("m1", customer, "Hi, is our Q3 variance report ready?", 20),
    item("m2", agent, "Yes. Revenue came in 4% under budget, and marketing was 38% over: the spring campaign billed in July. The full report is in your shared folder as variance-report.md.", 19),
    item("m3", customer, "38% is more than we planned for. Can I talk to someone before we close the quarter?", 13),
    item("m4", agent, "Of course. I've asked someone from the Acme Books team to join this conversation; they'll reply here.", 12),
  ];
  if (holder === "ada") {
    items.push(
      item("m5", customer, "Thanks. We'd like to move part of the overspend to Q4.", 2),
      item("m6", platform, TAKE_OVER_EXAMPLE.acknowledgment, 2),
    );
  }
  return items;
}

/**
 * The workbench's height for each holder: tall enough, at the shown
 * pictures' 1000 px width, that Northwind's whole conversation fits. A
 * timeline with nothing to scroll draws the same every run, where the kit's
 * pin to the latest message can land a row short under load (stigmer#2911).
 */
const WORKBENCH_HEIGHT: Record<Holder, number> = { agent: 1000, ada: 1140 };

/** The console's Conversations page, Northwind's conversation open, as the web host frames it (the page's full height). */
function Workbench({ holder }: { readonly holder: Holder }): ReactElement {
  const [selected, setSelected] = useState<ConversationIdentity | null>({ channelId: CHANNEL_ID, conversationKey: "15550100142" });
  return (
    <div style={{ height: WORKBENCH_HEIGHT[holder], display: "flex", flexDirection: "column" }}>
      <ConversationsWorkbench org={ORGANIZATION.metadata?.slug ?? ""} selected={selected} onSelectionChange={setSelected} currentIdentityAccountId={ACCOUNT.metadata?.id} />
    </div>
  );
}

/** Conversations, with Northwind's conversation open: escalated to a person, or held by Ada. */
export function conversationsScene(holder: Holder): Drawing {
  const conversations = [northwind(holder), FERNHILL];
  return {
    inOrganization: true,
    routes: (router: ConnectRouter) => {
      router.service(OrganizationQueryController, { listMine: () => samples.organizationList([ORGANIZATION]), get: () => ORGANIZATION });
      router.service(IdentityAccountQueryController, { whoAmI: () => ACCOUNT });
      router.service(GrantQueryController, { checkMyPermission: () => ({ isAuthorized: true }) });
      router.service(ChannelQueryController, { get: () => WHATSAPP_CHANNEL, list: () => ({ entries: [WHATSAPP_CHANNEL] }) });
      router.service(ChannelConversationQueryController, {
        list: (input) => ({ entries: input.filter === 1 ? conversations.filter((c) => c.needsAttention || c.awaitingReply) : conversations }),
        countConversations: () => ({ count: holder === "agent" ? 1 : 1 }),
        getConversation: (input) => conversations.find((c) => c.conversationKey === input.conversationKey) ?? conversations[0],
        listTimeline: (input) => ({ entries: input.conversationKey === "15550100142" ? northwindTimeline(holder) : [] }),
      });
    },
    render: () => <Workbench holder={holder} />,
  };
}

// Accessibility audit — the conversation list pane and timeline view.
//
// Covers the populated inbox (attention badge, human-control caption,
// channel filter), the WhatsApp-style timeline (both bubble sides, the
// two status axes, internal-lane system rows, the Slack honesty notice),
// and both empty states — each in light + dark against the shipped
// stylesheet.

import { describe, it, afterEach, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import {
  ChannelConversationSchema,
  ConversationControl,
  ConversationItemAuthor,
  ConversationLane,
  ConversationTimelineItemSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { ChannelDeliveryStatus } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/delivery_pb";
import { ChannelReceiptState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/outbound_pb";
import { ConversationListPane } from "../../ConversationListPane.js";
import { ConversationTimelineView } from "../../ConversationTimelineView.js";
import {
  COLOR_MODES,
  auditA11y,
  renderAudited,
  resetConversationAudit,
} from "./harness.js";

const NOW = new Date("2026-08-07T12:00:00Z");
const noop = () => {};

const channels = [
  create(AgentChannelSchema, {
    metadata: { id: "ach_wa", org: "acme", name: "support-line", slug: "support-line" },
    spec: { providerConfig: { case: "whatsapp", value: {} } },
  }),
  create(AgentChannelSchema, {
    metadata: { id: "ach_sl", org: "acme", name: "eng-help", slug: "eng-help" },
    spec: { providerConfig: { case: "slack", value: {} } },
  }),
];

const conversations = [
  create(ChannelConversationSchema, {
    agentChannelId: "ach_wa",
    conversationKey: "15550001111",
    org: "acme",
    displayName: "Pat",
    needsAttention: true,
    attentionReason: "refund I cannot process",
    lastActivityAt: timestampFromDate(new Date("2026-08-07T11:55:00Z")),
  }),
  create(ChannelConversationSchema, {
    agentChannelId: "ach_wa",
    conversationKey: "15550002222",
    org: "acme",
    control: ConversationControl.control_human,
    controlledBy: "idt_staff",
    lastActivityAt: timestampFromDate(new Date("2026-08-07T09:00:00Z")),
  }),
];

const timelineItems = [
  create(ConversationTimelineItemSchema, {
    itemId: "wa:1",
    lane: ConversationLane.lane_public,
    author: ConversationItemAuthor.author_customer,
    text: "where is my order?",
    at: timestampFromDate(new Date("2026-08-06T18:00:00Z")),
  }),
  create(ConversationTimelineItemSchema, {
    itemId: "wa:2",
    lane: ConversationLane.lane_public,
    author: ConversationItemAuthor.author_customer,
    providerMessageType: "image",
    at: timestampFromDate(new Date("2026-08-07T08:59:00Z")),
  }),
  create(ConversationTimelineItemSchema, {
    itemId: "ev:3",
    lane: ConversationLane.lane_internal,
    author: ConversationItemAuthor.author_agent,
    text: "the member is asking about a refund I cannot process",
    at: timestampFromDate(new Date("2026-08-07T09:00:00Z")),
  }),
  create(ConversationTimelineItemSchema, {
    itemId: "dl:4",
    lane: ConversationLane.lane_public,
    author: ConversationItemAuthor.author_agent,
    text: "checking with the team now",
    deliveryStatus: ChannelDeliveryStatus.delivered,
    receiptState: ChannelReceiptState.receipt_read,
    at: timestampFromDate(new Date("2026-08-07T09:01:00Z")),
  }),
  create(ConversationTimelineItemSchema, {
    itemId: "ob:5",
    lane: ConversationLane.lane_public,
    author: ConversationItemAuthor.author_teammate,
    text: "I'll take this personally",
    deliveryStatus: ChannelDeliveryStatus.delivered,
    receiptState: ChannelReceiptState.receipt_failed,
    at: timestampFromDate(new Date("2026-08-07T09:02:00Z")),
  }),
  create(ConversationTimelineItemSchema, {
    itemId: "ob:6",
    lane: ConversationLane.lane_public,
    author: ConversationItemAuthor.author_agent,
    text: "a reminder that never went",
    deliveryStatus: ChannelDeliveryStatus.suppressed,
    at: timestampFromDate(new Date("2026-08-07T09:03:00Z")),
  }),
];

const listBaseProps = {
  isLoading: false,
  error: null,
  hasMore: true,
  loadMore: noop,
  isLoadingMore: false,
  channels,
  channelFilter: "",
  onChannelFilterChange: noop,
  onSelect: noop,
  now: NOW,
};

const timelineBaseProps = {
  isLoading: false,
  error: null,
  hasOlder: true,
  loadOlder: noop,
  isLoadingOlder: false,
  now: NOW,
};

afterEach(() => {
  resetConversationAudit();
  vi.restoreAllMocks();
});

describe("Conversation surfaces a11y", () => {
  it.each(COLOR_MODES)("populated inbox with badges and filter (%s)", async (mode) => {
    const container = renderAudited(
      <ConversationListPane
        {...listBaseProps}
        conversations={conversations}
        selected={{ agentChannelId: "ach_wa", conversationKey: "15550001111" }}
      />,
      mode,
    );
    await auditA11y(container, `conversation list · ${mode}`);
  });

  it.each(COLOR_MODES)("inbox empty states (%s)", async (mode) => {
    const container = renderAudited(
      <ConversationListPane
        {...listBaseProps}
        conversations={[]}
        channels={[]}
        hasMore={false}
        selected={null}
      />,
      mode,
    );
    await auditA11y(container, `conversation list empty · ${mode}`);
  });

  it.each(COLOR_MODES)("timeline with both sides, status axes, internal rows (%s)", async (mode) => {
    const container = renderAudited(
      <ConversationTimelineView
        {...timelineBaseProps}
        items={timelineItems}
        provider="whatsapp"
      />,
      mode,
    );
    await auditA11y(container, `conversation timeline · ${mode}`);
  });

  it.each(COLOR_MODES)("timeline Slack honesty notice (%s)", async (mode) => {
    const container = renderAudited(
      <ConversationTimelineView
        {...timelineBaseProps}
        items={[]}
        hasOlder={false}
        provider="slack"
      />,
      mode,
    );
    await auditA11y(container, `slack timeline notice · ${mode}`);
  });
});

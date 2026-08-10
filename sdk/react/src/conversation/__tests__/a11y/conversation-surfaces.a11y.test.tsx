// Accessibility audit — the conversation list pane and timeline view.
//
// Covers the populated inbox (attention badge, human-control caption,
// channel filter, the wants-human filter control, both awaiting-reply
// indicator strengths), the WhatsApp-style timeline (both bubble sides,
// the two status axes, the visible receipt-failure explanation,
// internal-lane system rows, the Slack honesty notice), the staff
// composer with the closed-window advisory (T07 DD-014), and the empty
// states including the filtered one — each in light + dark against the
// shipped stylesheet.

import { describe, it, afterEach, expect, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { Stigmer } from "@stigmer/sdk";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import {
  ChannelConversationListFilter,
  ChannelConversationSchema,
  ConversationControl,
  ConversationItemAuthor,
  ConversationLane,
  ConversationTimelineItemSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { ChannelDeliveryStatus } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/delivery_pb";
import { ChannelReceiptState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/outbound_pb";
import { StigmerContext } from "../../../context.js";
import { ConversationComposer } from "../../ConversationComposer.js";
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
    // Agent-held and awaiting: the muted indicator strength.
    awaitingReply: true,
    lastActivityAt: timestampFromDate(new Date("2026-08-07T11:55:00Z")),
  }),
  create(ChannelConversationSchema, {
    agentChannelId: "ach_wa",
    conversationKey: "15550002222",
    org: "acme",
    control: ConversationControl.control_human,
    controlledBy: "idt_staff",
    // Human-held and awaiting: the strong indicator strength (F-13).
    awaitingReply: true,
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
    // The T07 visible explanation line (DD-014 D-c) rides the audit.
    receiptDetail:
      "More than 24 hours have passed since the recipient last replied to the sender number.",
    receiptErrorCode: 131047,
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

// Inbound-media fixtures (stigmer/stigmer#367): a captioned photo and a
// document. Media rendering needs the conversation address AND a client
// that answers getMediaDownloadUrl — the inner provider below overrides
// the harness stub with one minting a data-URI image, so the audit sees
// the loaded thumbnail, not just the pulse placeholder.
const mediaTimelineItems = [
  create(ConversationTimelineItemSchema, {
    itemId: "wa:7",
    lane: ConversationLane.lane_public,
    author: ConversationItemAuthor.author_customer,
    providerMessageType: "image",
    text: "here's the leak under the sink",
    media: {
      filename: "kitchen-leak.jpg",
      contentType: "image/jpeg",
      sizeBytes: BigInt(204800),
    },
    at: timestampFromDate(new Date("2026-08-07T09:04:00Z")),
  }),
  create(ConversationTimelineItemSchema, {
    itemId: "wa:8",
    lane: ConversationLane.lane_public,
    author: ConversationItemAuthor.author_customer,
    providerMessageType: "document",
    media: {
      filename: "lease-agreement.pdf",
      contentType: "application/pdf",
      sizeBytes: BigInt(1048576),
    },
    at: timestampFromDate(new Date("2026-08-07T09:05:00Z")),
  }),
];

// A 1×1 transparent PNG — enough for a real <img> load in the browser.
const ONE_PX_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const mediaClient = {
  agentChannel: {
    getMediaDownloadUrl: () => Promise.resolve({ url: ONE_PX_PNG }),
  },
} as unknown as Stigmer;

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
  it.each(COLOR_MODES)("populated inbox with badges, indicators, and filters (%s)", async (mode) => {
    const container = renderAudited(
      <ConversationListPane
        {...listBaseProps}
        conversations={conversations}
        onFilterChange={noop}
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

  it.each(COLOR_MODES)("filtered inbox empty state (%s)", async (mode) => {
    const container = renderAudited(
      <ConversationListPane
        {...listBaseProps}
        conversations={[]}
        hasMore={false}
        filter={ChannelConversationListFilter.filter_wants_human}
        onFilterChange={noop}
        selected={null}
      />,
      mode,
    );
    await auditA11y(container, `filtered conversation list empty · ${mode}`);
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

  it.each(COLOR_MODES)("timeline with inbound media: thumbnail and document chip (%s)", async (mode) => {
    const container = renderAudited(
      <StigmerContext.Provider value={mediaClient}>
        <ConversationTimelineView
          {...timelineBaseProps}
          agentChannelId="ach_wa"
          conversationKey="15550001111"
          items={mediaTimelineItems}
          hasOlder={false}
          provider="whatsapp"
        />
      </StigmerContext.Provider>,
      mode,
    );
    // Audit the LOADED thumbnail (the interactive state operators use),
    // not just the pulse placeholder the first frame shows.
    await waitFor(() => expect(container.querySelector("img")).toBeTruthy());
    await auditA11y(container, `conversation timeline media · ${mode}`);
  });

  it.each(COLOR_MODES)("composer with the closed-window advisory (%s)", async (mode) => {
    const container = renderAudited(
      <ConversationComposer
        onSend={() => Promise.reject(new Error("never sent in an audit"))}
        isSending={false}
        disabledReason={null}
        advisory="WhatsApp closes free-form replies 24 hours after the customer's last message — a reply sent now will probably fail. The window reopens when the customer writes again."
      />,
      mode,
    );
    await auditA11y(container, `composer with advisory · ${mode}`);
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

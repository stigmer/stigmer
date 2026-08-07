import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  ChannelConversationSchema,
  ConversationItemAuthor,
  ConversationLane,
  ConversationTimelineItemSchema,
  type ConversationTimelineItem,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { ChannelDeliveryStatus } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/delivery_pb";
import { ChannelReceiptState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/outbound_pb";
import {
  authorKindOf,
  compareTimelineItemsNewestFirst,
  conversationLabelOf,
  inboundPlaceholderOf,
  isInternalItem,
  receiptOf,
  sendAttemptOf,
} from "../conversationPresentation";

function item(fields: Parameters<typeof create<typeof ConversationTimelineItemSchema>>[1]) {
  return create(ConversationTimelineItemSchema, fields);
}

describe("authorKindOf", () => {
  it("maps every wire author onto the render vocabulary", () => {
    expect(authorKindOf(item({ author: ConversationItemAuthor.author_customer }))).toBe("customer");
    expect(authorKindOf(item({ author: ConversationItemAuthor.author_agent }))).toBe("agent");
    expect(authorKindOf(item({ author: ConversationItemAuthor.author_teammate }))).toBe("teammate");
    expect(authorKindOf(item({ author: ConversationItemAuthor.author_platform }))).toBe("platform");
  });

  it("answers unknown for the unspecified author rather than guessing", () => {
    expect(authorKindOf(item({}))).toBe("unknown");
  });
});

describe("isInternalItem", () => {
  it("flags internal-lane items and only those", () => {
    expect(isInternalItem(item({ lane: ConversationLane.lane_internal }))).toBe(true);
    expect(isInternalItem(item({ lane: ConversationLane.lane_public }))).toBe(false);
    expect(isInternalItem(item({}))).toBe(false);
  });
});

describe("the two status axes (DD-004 D-d: never collapsed)", () => {
  it("maps the send attempt independently of the receipt", () => {
    expect(sendAttemptOf(item({ deliveryStatus: ChannelDeliveryStatus.pending }))).toBe("pending");
    expect(sendAttemptOf(item({ deliveryStatus: ChannelDeliveryStatus.delivering }))).toBe("delivering");
    expect(sendAttemptOf(item({ deliveryStatus: ChannelDeliveryStatus.delivered }))).toBe("delivered");
    expect(sendAttemptOf(item({ deliveryStatus: ChannelDeliveryStatus.failed }))).toBe("failed");
    expect(sendAttemptOf(item({ deliveryStatus: ChannelDeliveryStatus.suppressed }))).toBe("suppressed");
    expect(sendAttemptOf(item({}))).toBeNull();
  });

  it("maps the receipt independently of the send attempt", () => {
    expect(receiptOf(item({ receiptState: ChannelReceiptState.receipt_sent }))).toBe("sent");
    expect(receiptOf(item({ receiptState: ChannelReceiptState.receipt_delivered }))).toBe("delivered");
    expect(receiptOf(item({ receiptState: ChannelReceiptState.receipt_read }))).toBe("read");
    expect(receiptOf(item({ receiptState: ChannelReceiptState.receipt_failed }))).toBe("failed");
    expect(receiptOf(item({}))).toBeNull();
  });

  it("represents the provider-accepted-then-failed item: delivered attempt, failed receipt", () => {
    // The combination a collapsed single status cannot express — "we
    // handed it to the provider" AND "it never reached the phone".
    const acceptedThenFailed = item({
      deliveryStatus: ChannelDeliveryStatus.delivered,
      receiptState: ChannelReceiptState.receipt_failed,
    });
    expect(sendAttemptOf(acceptedThenFailed)).toBe("delivered");
    expect(receiptOf(acceptedThenFailed)).toBe("failed");
  });

  it("keeps inbound items off both axes", () => {
    const inbound = item({
      author: ConversationItemAuthor.author_customer,
      text: "hello",
    });
    expect(sendAttemptOf(inbound)).toBeNull();
    expect(receiptOf(inbound)).toBeNull();
  });
});

describe("inboundPlaceholderOf", () => {
  it("names the known non-text kinds", () => {
    expect(inboundPlaceholderOf(item({ providerMessageType: "image" }))).toBe("Photo");
    expect(inboundPlaceholderOf(item({ providerMessageType: "audio" }))).toBe("Voice message");
    expect(inboundPlaceholderOf(item({ providerMessageType: "document" }))).toBe("Document");
    expect(inboundPlaceholderOf(item({ providerMessageType: "location" }))).toBe("Location");
  });

  it("passes an unknown provider kind through verbatim, never re-encoded", () => {
    expect(inboundPlaceholderOf(item({ providerMessageType: "reaction" })))
      .toBe("Unsupported message (reaction)");
  });

  it("needs no placeholder for items with text or without a provider type", () => {
    expect(inboundPlaceholderOf(item({ text: "hi", providerMessageType: "text" }))).toBeNull();
    // Empty text + empty type: internal events (attention clears) and
    // template sends — their copy is the renderer's, not a placeholder.
    expect(inboundPlaceholderOf(item({}))).toBeNull();
  });
});

describe("conversationLabelOf", () => {
  it("prefers the provider-reported display name", () => {
    const conversation = create(ChannelConversationSchema, {
      conversationKey: "15550001111",
      displayName: "Pat",
    });
    expect(conversationLabelOf(conversation, "whatsapp")).toBe("Pat");
  });

  it("falls back to the key on WhatsApp — a phone number is a real label", () => {
    const conversation = create(ChannelConversationSchema, {
      conversationKey: "15550001111",
    });
    expect(conversationLabelOf(conversation, "whatsapp")).toBe("15550001111");
    expect(conversationLabelOf(conversation, null)).toBe("15550001111");
  });

  it("never shows a Slack thread timestamp as a name", () => {
    const conversation = create(ChannelConversationSchema, {
      conversationKey: "1723012345.678900",
    });
    expect(conversationLabelOf(conversation, "slack")).toBe("Slack thread");
  });
});

describe("compareTimelineItemsNewestFirst", () => {
  const at = (iso: string) => timestampFromDate(new Date(iso));

  it("orders by instant descending", () => {
    const older = item({ itemId: "wa:1", at: at("2026-08-07T09:00:00Z") });
    const newer = item({ itemId: "dl:2", at: at("2026-08-07T09:00:05Z") });
    expect([older, newer].sort(compareTimelineItemsNewestFirst)).toEqual([newer, older]);
  });

  it("orders sub-second instants by nanos — the 007/D7 string-inversion trap is structurally absent", () => {
    const wholeSecond = item({ itemId: "wa:1", at: at("2026-08-07T09:00:00.000Z") });
    const midSecond = item({ itemId: "wa:2", at: at("2026-08-07T09:00:00.123Z") });
    // As RFC-3339 TEXT, "..:00.123Z" sorts BEFORE "..:00Z" — the
    // inversion the server corrects by parsing. This comparator works on
    // seconds+nanos, so chronology holds by construction.
    expect([midSecond, wholeSecond].sort(compareTimelineItemsNewestFirst)).toEqual([
      midSecond,
      wholeSecond,
    ]);
  });

  it("breaks instant ties by item id descending — the server's exact tiebreak", () => {
    const instant = at("2026-08-07T09:00:00Z");
    const a = item({ itemId: "dl:aaa", at: instant });
    const b = item({ itemId: "wa:bbb", at: instant });
    expect([a, b].sort(compareTimelineItemsNewestFirst)).toEqual([b, a]);
  });

  it("sorts an instant-less defensive item oldest instead of crashing", () => {
    const bare = item({ itemId: "wa:bare" });
    const dated = item({ itemId: "wa:dated", at: at("2026-08-07T09:00:00Z") });
    const sorted: ConversationTimelineItem[] = [bare, dated].sort(
      compareTimelineItemsNewestFirst,
    );
    expect(sorted[0]).toBe(dated);
  });
});

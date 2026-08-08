import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  ChannelConversationSchema,
  ConversationControl,
  ConversationItemAuthor,
  ConversationLane,
  ConversationTimelineItemSchema,
  type ConversationTimelineItem,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { ChannelDeliveryStatus } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/delivery_pb";
import { ChannelReceiptState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/outbound_pb";
import {
  authorKindOf,
  awaitingIndicatorOf,
  compareTimelineItemsNewestFirst,
  conversationContactOf,
  conversationLabelOf,
  inboundPlaceholderOf,
  isInternalItem,
  outboundItemIdOf,
  receiptOf,
  sendAttemptOf,
  serviceWindowOf,
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

describe("awaitingIndicatorOf (DD-011 D-a: strength maps the holder)", () => {
  it("renders strongly when a human holds an awaiting conversation — the agent will not answer", () => {
    expect(
      awaitingIndicatorOf(
        create(ChannelConversationSchema, {
          awaitingReply: true,
          control: ConversationControl.control_human,
        }),
      ),
    ).toBe("strong");
  });

  it("renders mutedly when the agent holds an awaiting conversation — an answer is on its way", () => {
    expect(
      awaitingIndicatorOf(
        create(ChannelConversationSchema, {
          awaitingReply: true,
          control: ConversationControl.control_agent,
        }),
      ),
    ).toBe("muted");
    // The unspecified holder defaults to the agent (proto3 zero value).
    expect(
      awaitingIndicatorOf(create(ChannelConversationSchema, { awaitingReply: true })),
    ).toBe("muted");
  });

  it("renders nothing once the customer is answered, whoever holds it", () => {
    expect(
      awaitingIndicatorOf(
        create(ChannelConversationSchema, {
          control: ConversationControl.control_human,
        }),
      ),
    ).toBeNull();
    expect(awaitingIndicatorOf(create(ChannelConversationSchema, {}))).toBeNull();
  });
});

describe("outboundItemIdOf", () => {
  it("names the timeline item an accepted staff reply appears under (the ob: namespace)", () => {
    expect(outboundItemIdOf("obm_1")).toBe("ob:obm_1");
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

describe("conversationContactOf", () => {
  it("surfaces the WhatsApp number a display name would otherwise hide (F-17)", () => {
    const conversation = create(ChannelConversationSchema, {
      conversationKey: "15550001111",
      displayName: "Pat",
    });
    // Verbatim wire value — no fabricated "+" prefix.
    expect(conversationContactOf(conversation, "whatsapp")).toBe("15550001111");
  });

  it("adds nothing when the label already shows the key", () => {
    const conversation = create(ChannelConversationSchema, {
      conversationKey: "15550001111",
    });
    expect(conversationContactOf(conversation, "whatsapp")).toBeNull();
  });

  it("answers null for keys that are not reachable addresses", () => {
    const slackThread = create(ChannelConversationSchema, {
      conversationKey: "1723012345.678900",
      displayName: "deploy question",
    });
    expect(conversationContactOf(slackThread, "slack")).toBeNull();
    // An unknown provider shows nothing rather than guessing that its
    // key is an address.
    expect(conversationContactOf(slackThread, null)).toBeNull();
  });
});

describe("serviceWindowOf (DD-014 D-a: client-derived, WhatsApp-only)", () => {
  const NOW = new Date("2026-08-08T12:00:00Z");
  const lastWrote = (iso: string) =>
    create(ChannelConversationSchema, {
      conversationKey: "15550001111",
      lastCustomerMessageAt: timestampFromDate(new Date(iso)),
    });

  it("answers open inside the 24-hour window", () => {
    expect(serviceWindowOf(lastWrote("2026-08-08T11:59:00Z"), "whatsapp", NOW)).toBe("open");
    // One millisecond inside the boundary.
    expect(serviceWindowOf(lastWrote("2026-08-07T12:00:00.001Z"), "whatsapp", NOW)).toBe(
      "open",
    );
  });

  it("answers closed at exactly 24 hours — the tie closes because our anchor already lags Meta's", () => {
    // The stored anchor is the platform's receipt instant, minutes AFTER
    // Meta's own clock started the window, so the estimate inherently
    // errs toward claiming open too long. Closing the tie is the honest
    // offset; the warn-never-block posture (DD-014 D-b) makes either
    // direction safe to render.
    expect(serviceWindowOf(lastWrote("2026-08-07T12:00:00Z"), "whatsapp", NOW)).toBe("closed");
    expect(serviceWindowOf(lastWrote("2026-08-06T09:00:00Z"), "whatsapp", NOW)).toBe("closed");
  });

  it("makes no claim without a customer message — that conversation is the composer's disabled branch", () => {
    expect(serviceWindowOf(create(ChannelConversationSchema, {}), "whatsapp", NOW)).toBeNull();
  });

  it("makes no claim for providers without a window", () => {
    const stale = lastWrote("2026-08-01T09:00:00Z");
    expect(serviceWindowOf(stale, "slack", NOW)).toBeNull();
    expect(serviceWindowOf(stale, null, NOW)).toBeNull();
  });

  it("reads a future-dated customer message as open instead of misfiring on clock skew", () => {
    expect(serviceWindowOf(lastWrote("2026-08-08T12:05:00Z"), "whatsapp", NOW)).toBe("open");
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

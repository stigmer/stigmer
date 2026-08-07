import type { Timestamp } from "@bufbuild/protobuf/wkt";
import {
  type ChannelConversation,
  ConversationItemAuthor,
  ConversationLane,
  type ConversationTimelineItem,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { ChannelDeliveryStatus } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/delivery_pb";
import { ChannelReceiptState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/outbound_pb";
import type { ChannelProviderId } from "../channel/providers.js";

/**
 * Pure render vocabulary for the conversation surface — the single place
 * the wire enums become words and layout facts (the providerPresentation
 * convention). No React, no I/O; every component and every test reads the
 * same mapping.
 */

/** Who authored a timeline item, in render vocabulary. */
export type ConversationAuthorKind =
  | "customer"
  | "agent"
  | "teammate"
  | "platform"
  | "unknown";

/** Map the wire author onto the render vocabulary. */
export function authorKindOf(item: ConversationTimelineItem): ConversationAuthorKind {
  switch (item.author) {
    case ConversationItemAuthor.author_customer:
      return "customer";
    case ConversationItemAuthor.author_agent:
      return "agent";
    case ConversationItemAuthor.author_teammate:
      return "teammate";
    case ConversationItemAuthor.author_platform:
      return "platform";
    default:
      return "unknown";
  }
}

/** True for org-internal items (escalations, attention clears, notes). */
export function isInternalItem(item: ConversationTimelineItem): boolean {
  return item.lane === ConversationLane.lane_internal;
}

/**
 * The platform's own send attempt, in render vocabulary. `null` on items
 * that carry no attempt (inbound messages, internal events).
 *
 * `"suppressed"` and `"failed"` are items the customer NEVER saw and
 * `"pending"`/`"delivering"` are items the customer has not seen YET —
 * a renderer that shows any of them as a plain sent bubble lies to staff.
 */
export type SendAttemptKind =
  | "pending"
  | "delivering"
  | "delivered"
  | "failed"
  | "suppressed";

/** Map the wire delivery status onto the render vocabulary. */
export function sendAttemptOf(item: ConversationTimelineItem): SendAttemptKind | null {
  switch (item.deliveryStatus) {
    case ChannelDeliveryStatus.pending:
      return "pending";
    case ChannelDeliveryStatus.delivering:
      return "delivering";
    case ChannelDeliveryStatus.delivered:
      return "delivered";
    case ChannelDeliveryStatus.failed:
      return "failed";
    case ChannelDeliveryStatus.suppressed:
      return "suppressed";
    default:
      return null;
  }
}

/**
 * The provider's receipt report, in render vocabulary. `null` until the
 * provider reports (and always on items with no receipt axis).
 *
 * A SECOND axis beside {@link sendAttemptOf}, never collapsed into it
 * (channel-conversations DD-004 D-d): "we handed it to WhatsApp" and
 * "it reached the phone" are different facts — an item can be
 * `delivered` + `receipt_failed`.
 */
export type ReceiptKind = "sent" | "delivered" | "read" | "failed";

/** Map the wire receipt state onto the render vocabulary. */
export function receiptOf(item: ConversationTimelineItem): ReceiptKind | null {
  switch (item.receiptState) {
    case ChannelReceiptState.receipt_sent:
      return "sent";
    case ChannelReceiptState.receipt_delivered:
      return "delivered";
    case ChannelReceiptState.receipt_read:
      return "read";
    case ChannelReceiptState.receipt_failed:
      return "failed";
    default:
      return null;
  }
}

/**
 * Placeholder copy for inbound items whose body the platform cannot
 * render (`text` empty, `provider_message_type` names the kind). Media
 * retrieval is a named non-goal of this surface — the placeholder tells
 * staff something arrived and what shape it was.
 *
 * Returns `null` when the item needs no placeholder (it has text, or it
 * is not a provider-typed inbound item — e.g. an attention-clear event,
 * whose copy is the renderer's own vocabulary).
 */
export function inboundPlaceholderOf(item: ConversationTimelineItem): string | null {
  if (item.text !== "" || item.providerMessageType === "") return null;
  switch (item.providerMessageType) {
    case "text":
      return null;
    case "image":
      return "Photo";
    case "video":
      return "Video";
    case "audio":
      return "Voice message";
    case "document":
      return "Document";
    case "sticker":
      return "Sticker";
    case "location":
      return "Location";
    case "contacts":
      return "Contact card";
    default:
      // The provider's vocabulary passes through verbatim (never
      // re-encoded), so an unknown kind still names itself.
      return `Unsupported message (${item.providerMessageType})`;
  }
}

/**
 * The list-row label for a conversation: the provider-reported display
 * name when one exists, else a provider-aware fallback.
 *
 * The fallback is provider-aware because conversation keys are not
 * uniformly meaningful: WhatsApp's key is the customer's phone number
 * (a real label), while Slack's key is a thread timestamp like
 * `1723012345.678900` (noise a human cannot use).
 */
export function conversationLabelOf(
  conversation: ChannelConversation,
  provider: ChannelProviderId | null,
): string {
  if (conversation.displayName !== "") return conversation.displayName;
  if (provider === "slack") return "Slack thread";
  return conversation.conversationKey;
}

/**
 * The customer's reachable address, when the label hides it: the fact a
 * staffer needs to call or message the customer outside the platform.
 *
 * Provider-aware like {@link conversationLabelOf}, because conversation
 * keys are not uniformly addresses: WhatsApp's key IS the customer's
 * phone number (the wa_id), and when a display name wins the label slot
 * that number would otherwise appear nowhere on the surface. Slack's
 * key is a thread timestamp — not a way to reach anyone — so there is
 * nothing to show. Unknown providers show nothing rather than guess.
 *
 * Returns `null` when the label already shows the key (no display
 * name), so the same fact never renders twice. The key returns
 * verbatim — no fabricated `+` prefix: the wire value is the truth this
 * module reports, and formatting belongs to hosts that know their
 * display rules.
 */
export function conversationContactOf(
  conversation: ChannelConversation,
  provider: ChannelProviderId | null,
): string | null {
  if (provider !== "whatsapp") return null;
  if (conversation.displayName === "") return null;
  return conversation.conversationKey;
}

/**
 * The timeline item id an accepted staff reply appears under: the
 * outbound ledger's `ob:` namespace over the reply output's
 * `outbound_message_id` — the contract
 * `useConversationParticipation.reply` documents ("the item will
 * appear on the timeline as `ob:<that id>`"). The workbench's
 * post-send busy state watches for exactly this id (F-05).
 */
export function outboundItemIdOf(outboundMessageId: string): string {
  return `ob:${outboundMessageId}`;
}

/**
 * Newest-first timeline order: `(at, item_id)` descending — the exact
 * comparator the server pages with, so client-side merges can never
 * disagree with server pages about order.
 */
export function compareTimelineItemsNewestFirst(
  a: ConversationTimelineItem,
  b: ConversationTimelineItem,
): number {
  const byInstant = compareInstants(b.at, a.at);
  if (byInstant !== 0) return byInstant;
  return a.itemId < b.itemId ? 1 : a.itemId > b.itemId ? -1 : 0;
}

// BigInt() call form, not a 0n literal: the web console compiles SDK
// sources under a pre-ES2020 target where the literal is a syntax error.
const ZERO_SECONDS = BigInt(0);

function compareInstants(a: Timestamp | undefined, b: Timestamp | undefined): number {
  // A missing instant sorts oldest — the server always stamps `at`, so
  // this only orders a defensively-handled corrupt item to the top of
  // history rather than crashing the sort.
  const aSeconds = a?.seconds ?? ZERO_SECONDS;
  const bSeconds = b?.seconds ?? ZERO_SECONDS;
  if (aSeconds !== bSeconds) return aSeconds < bSeconds ? -1 : 1;
  const aNanos = a?.nanos ?? 0;
  const bNanos = b?.nanos ?? 0;
  return aNanos - bNanos;
}

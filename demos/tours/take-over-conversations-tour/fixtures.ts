/**
 * Fixture cast for the take-over-conversations tour — one WhatsApp channel
 * and four customer conversations, each frozen in the exact state one beat
 * of `docs/guides/channels/take-over-conversations.mdx` depicts. The
 * workbench's data arrives through RPC fixtures (see `.scenar/providers.tsx`),
 * and the mock is a pure function of its input, so each depicted state is
 * its own conversation — selecting a row IS selecting a beat:
 *
 *   - Pat Rivera   — agent-held, customer waiting (muted dot; timeline beat)
 *   - Jordan Lee   — human-held, customer waiting (strong dot; takeover beat)
 *   - Sam Okafor   — human-held, quiet past the 24h window (advisory beat)
 *   - Riley Chen   — agent escalated (attention-banner beat)
 *
 * Pure module by design: protos + `@stigmer/react/test` only, importable by
 * `steps.ts` under plain Node (the narrate/verify loader). Every instant
 * derives from the sample anchor via `sampleDate` — the tour world has one
 * clock (demos/README.md, fixture determinism).
 */
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import {
  ChannelConversationSchema,
  ConversationControl,
  ConversationItemAuthor,
  ConversationLane,
  ConversationTimelineItemSchema,
  type ChannelConversation,
  type ConversationTimelineItem,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { ChannelDeliveryStatus } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/delivery_pb";
import { ChannelReceiptState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/outbound_pb";
import { sampleDate } from "@stigmer/react/test";
import { DEMO_ORG } from "../_shared/fixtures";

/** The depicted channel's id — every conversation and RPC input carries it. */
export const CHANNEL_ID = "ach_support_line";

/**
 * The signed-in staff member's identity account id. Passed to the workbench
 * as `currentIdentityAccountId` and stamped as `controlledBy` on the
 * human-held conversations, so the control banner renders its "You have
 * this conversation" form rather than naming a third party.
 */
export const YOU = "idt_you";

const MINUTE = 60_000;
const HOUR = 3_600_000;

/** The WhatsApp channel the four conversations live on. */
export function supportLineChannel() {
  return create(AgentChannelSchema, {
    metadata: {
      id: CHANNEL_ID,
      org: DEMO_ORG,
      name: "support-line",
      slug: "support-line",
    },
    spec: {
      agentRef: { org: DEMO_ORG, slug: "support-agent" },
      providerConfig: { case: "whatsapp", value: {} },
    },
  });
}

function conversation(
  overrides: MessageInitShape<typeof ChannelConversationSchema> & {
    conversationKey: string;
  },
): ChannelConversation {
  return create(ChannelConversationSchema, {
    agentChannelId: CHANNEL_ID,
    org: DEMO_ORG,
    control: ConversationControl.control_agent,
    ...overrides,
  });
}

/** Riley — the Agent escalated; the attention banner names its reason. */
export const RILEY = conversation({
  conversationKey: "15550000104",
  displayName: "Riley Chen",
  needsAttention: true,
  attentionReason:
    "The customer wants to change a paid order — asking for a person.",
  attentionChangedAt: timestampFromDate(sampleDate(-10 * MINUTE)),
  lastCustomerMessageAt: timestampFromDate(sampleDate(-11 * MINUTE)),
  lastActivityAt: timestampFromDate(sampleDate(-10 * MINUTE)),
  // The agent keeps serving while flagged (the guide's "no dead air"),
  // so the customer is not awaiting a human reply — the row joins the
  // Needs-human list through the attention flag alone.
});

/** Pat — agent-held with the customer's follow-up unanswered (muted dot). */
export const PAT = conversation({
  conversationKey: "15550000101",
  displayName: "Pat Rivera",
  awaitingReply: true,
  lastCustomerMessageAt: timestampFromDate(sampleDate(-8 * MINUTE)),
  lastActivityAt: timestampFromDate(sampleDate(-8 * MINUTE)),
});

/** Jordan — your team holds it, customer waiting on a person (strong dot). */
export const JORDAN = conversation({
  conversationKey: "15550000102",
  displayName: "Jordan Lee",
  control: ConversationControl.control_human,
  controlledBy: YOU,
  controlChangedAt: timestampFromDate(sampleDate(-25 * MINUTE)),
  awaitingReply: true,
  lastCustomerMessageAt: timestampFromDate(sampleDate(-18 * MINUTE)),
  lastActivityAt: timestampFromDate(sampleDate(-18 * MINUTE)),
});

/**
 * Sam — human-held and quiet since yesterday: the last customer message is
 * 25 hours old, so WhatsApp's 24-hour free-form window is closed and the
 * composer renders the advisory (with its template lane, cloud#260).
 */
export const SAM = conversation({
  conversationKey: "15550000103",
  displayName: "Sam Okafor",
  control: ConversationControl.control_human,
  controlledBy: YOU,
  controlChangedAt: timestampFromDate(sampleDate(-25 * HOUR)),
  lastCustomerMessageAt: timestampFromDate(sampleDate(-25 * HOUR)),
  lastActivityAt: timestampFromDate(sampleDate(-24 * HOUR)),
});

/** Inbox order: newest activity first, exactly as the server lists. */
export const ALL_CONVERSATIONS: readonly ChannelConversation[] = [
  PAT,
  RILEY,
  JORDAN,
  SAM,
];

/**
 * The server-evaluated Needs-human predicate over the cast: the Agent
 * escalated (Riley), or a customer is waiting on a reply only a person
 * will send (Jordan). Also the sidebar badge's count — the badge and the
 * filter share one predicate by design (DD-011 D-f/D-g).
 */
export const WANTS_HUMAN_CONVERSATIONS: readonly ChannelConversation[] = [
  RILEY,
  JORDAN,
];

// ---------------------------------------------------------------------------
// Timelines (lane_public — what the customer's phone shows)
// ---------------------------------------------------------------------------

interface ItemSeed {
  readonly id: string;
  readonly author: ConversationItemAuthor;
  readonly text: string;
  /** Offset from the anchor, in milliseconds (negative = past). */
  readonly atOffsetMs: number;
  /** Provider receipt on outbound items; customer items carry none. */
  readonly receipt?: ChannelReceiptState;
}

function timelineOf(seeds: readonly ItemSeed[]): ConversationTimelineItem[] {
  return seeds.map((seed) =>
    create(ConversationTimelineItemSchema, {
      itemId: seed.id,
      lane: ConversationLane.lane_public,
      author: seed.author,
      text: seed.text,
      at: timestampFromDate(sampleDate(seed.atOffsetMs)),
      ...(seed.author === ConversationItemAuthor.author_customer
        ? {}
        : {
            deliveryStatus: ChannelDeliveryStatus.delivered,
            receiptState: seed.receipt ?? ChannelReceiptState.receipt_delivered,
          }),
    }),
  );
}

const TIMELINES: Record<string, readonly ConversationTimelineItem[]> = {
  [PAT.conversationKey]: timelineOf([
    {
      id: "pat:1",
      author: ConversationItemAuthor.author_customer,
      text: "Hi — my order ORD-4821 hasn't arrived yet.",
      atOffsetMs: -32 * MINUTE,
    },
    {
      id: "pat:2",
      author: ConversationItemAuthor.author_agent,
      text: "Sorry about the wait! Let me look up ORD-4821 right away.",
      atOffsetMs: -31 * MINUTE,
      receipt: ChannelReceiptState.receipt_read,
    },
    {
      id: "pat:3",
      author: ConversationItemAuthor.author_agent,
      text: "Your order left our warehouse yesterday and is out for delivery today.",
      atOffsetMs: -30 * MINUTE,
      receipt: ChannelReceiptState.receipt_read,
    },
    {
      id: "pat:4",
      author: ConversationItemAuthor.author_customer,
      text: "It has said “out for delivery” since yesterday though. Can you double-check?",
      atOffsetMs: -8 * MINUTE,
    },
  ]),
  [JORDAN.conversationKey]: timelineOf([
    {
      id: "jordan:1",
      author: ConversationItemAuthor.author_customer,
      text: "Can I change the shipping address on order ORD-7733?",
      atOffsetMs: -45 * MINUTE,
    },
    {
      id: "jordan:2",
      author: ConversationItemAuthor.author_agent,
      text: "I can help with that — what should the new address be?",
      atOffsetMs: -44 * MINUTE,
      receipt: ChannelReceiptState.receipt_read,
    },
    {
      id: "jordan:3",
      author: ConversationItemAuthor.author_customer,
      text: "Actually, I'd rather sort this out with a person.",
      atOffsetMs: -26 * MINUTE,
    },
    {
      id: "jordan:4",
      author: ConversationItemAuthor.author_teammate,
      text: "Happy to help personally — pulling up your order now.",
      atOffsetMs: -20 * MINUTE,
      receipt: ChannelReceiptState.receipt_read,
    },
    {
      id: "jordan:5",
      author: ConversationItemAuthor.author_customer,
      text: "Thank you! The new address is 12 Rose Lane, Springfield.",
      atOffsetMs: -18 * MINUTE,
    },
  ]),
  [SAM.conversationKey]: timelineOf([
    {
      id: "sam:1",
      author: ConversationItemAuthor.author_customer,
      text: "Do you have the ceramic mug in blue?",
      atOffsetMs: -26 * HOUR,
    },
    {
      id: "sam:2",
      author: ConversationItemAuthor.author_agent,
      text: "We do — the blue one is back in stock in both sizes.",
      atOffsetMs: -26 * HOUR + 2 * MINUTE,
      receipt: ChannelReceiptState.receipt_read,
    },
    {
      id: "sam:3",
      author: ConversationItemAuthor.author_customer,
      text: "I'll think about it, thanks!",
      atOffsetMs: -25 * HOUR,
    },
    {
      id: "sam:4",
      author: ConversationItemAuthor.author_teammate,
      text: "Of course — here whenever you're ready.",
      atOffsetMs: -24 * HOUR,
      receipt: ChannelReceiptState.receipt_delivered,
    },
  ]),
  [RILEY.conversationKey]: timelineOf([
    {
      id: "riley:1",
      author: ConversationItemAuthor.author_customer,
      text: "I need to change my paid order and the bot keeps looping. Get me a human please.",
      atOffsetMs: -11 * MINUTE,
    },
    {
      id: "riley:2",
      author: ConversationItemAuthor.author_agent,
      text: "I understand — I've flagged this for a teammate to pick up right away.",
      atOffsetMs: -10 * MINUTE,
      receipt: ChannelReceiptState.receipt_delivered,
    },
  ]),
};

/** Detail row by conversation key — the beat selector for `getConversation`. */
export function conversationByKey(key: string): ChannelConversation {
  const match = ALL_CONVERSATIONS.find((c) => c.conversationKey === key);
  if (!match) throw new Error(`no fixture conversation for key ${key}`);
  return match;
}

/** Timeline by conversation key, newest first (the server's page order). */
export function timelineByKey(key: string): ConversationTimelineItem[] {
  const items = TIMELINES[key];
  if (!items) throw new Error(`no fixture timeline for key ${key}`);
  return [...items].reverse();
}

"use client";

import { memo, useMemo } from "react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Ban, Check, CheckCheck, Clock, Info, MessageSquare, TriangleAlert } from "lucide-react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { ConversationTimelineItem } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { channelProviderOf, type ChannelProviderId } from "../channel/providers.js";
import { Button } from "../button/Button.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { JumpToLatestButton } from "../internal/JumpToLatestButton.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../internal/tooltip.js";
import { useAutoScroll } from "../internal/useAutoScroll.js";
import { ConversationMediaAttachment } from "./ConversationMediaAttachment.js";
import {
  authorKindOf,
  inboundPlaceholderOf,
  isInternalItem,
  receiptOf,
  sendAttemptOf,
  type ConversationAuthorKind,
} from "./conversationPresentation.js";

/** Props for {@link ConversationTimelineView}. */
export interface ConversationTimelineViewProps {
  /** Timeline items in chronological order (from `useConversationTimeline`). */
  readonly items: readonly ConversationTimelineItem[];
  /**
   * AgentChannel the conversation belongs to. Together with
   * `conversationKey`, this is the opt-in for media rendering: items
   * carrying `media` render an inline thumbnail or document chip whose
   * bytes are fetched via `getMediaDownloadUrl` — which is addressed by
   * (channel, conversation, item), so the view cannot fetch media
   * without the address.
   *
   * When either identity prop is absent, media items keep the typed
   * placeholder ("Photo", "Document") — and, load-bearing for
   * provider-less hosts (documentation fixtures, visual tests): nothing
   * that needs a `StigmerProvider` mounts, so the view stays purely
   * presentational exactly as before these props existed.
   */
  readonly agentChannelId?: string;
  /** Conversation key within the channel (see `agentChannelId`). */
  readonly conversationKey?: string;
  /** `true` only during the first load. */
  readonly isLoading: boolean;
  /** Error from the timeline read, or `null`. */
  readonly error: Error | null;
  /** `true` while older history exists beyond what is loaded. */
  readonly hasOlder: boolean;
  /** Load the next older page. */
  readonly loadOlder: () => void;
  /** `true` while an older page is in flight. */
  readonly isLoadingOlder: boolean;
  /**
   * The channel's provider, for the honest-timeline notice: providers
   * whose inbound lane has no timeline source (Slack) render an
   * explicit "customer messages aren't shown" notice instead of a
   * silently one-sided thread. `null` renders no notice.
   */
  readonly provider: ChannelProviderId | null;
  /** Frozen instant for deterministic hosts (tests, documentation tours). */
  readonly now?: Date;
  /** Additional classes for the view container. */
  readonly className?: string;
}

/**
 * One conversation's customer-visible thread, WhatsApp-style: customer
 * on the left, the business (agent, teammate, platform copy) on the
 * right, internal-lane events (escalations, attention clears) as inline
 * system rows the customer never saw.
 *
 * Honesty rules, enforced here rather than hoped for: outbound items
 * carry their send attempt AND the provider's receipt as two independent
 * facts (DD-004 D-d — an item can be handed to the provider yet fail on
 * the customer's side), failed and suppressed sends render as exactly
 * that, and non-text inbound renders a typed placeholder instead of
 * disappearing.
 *
 * Presentational — pair with `useConversationTimeline`, or compose via
 * `ConversationsWorkbench`.
 */
export function ConversationTimelineView({
  items,
  agentChannelId,
  conversationKey,
  isLoading,
  error,
  hasOlder,
  loadOlder,
  isLoadingOlder,
  provider,
  now,
  className,
}: ConversationTimelineViewProps) {
  const { scrollRef, sentinelRef, contentRef, isFollowing, jumpToLatest } =
    useAutoScroll();

  const days = useMemo(() => groupByDay(items, now), [items, now]);
  const descriptor = channelProviderOf(provider ?? undefined);
  const showsCustomerMessages = descriptor?.timelineIncludesCustomerMessages ?? true;

  return (
    // The provider is context-only (no DOM node); one per view arms
    // every status-glyph tooltip below (the WorkspaceSidebar precedent).
    <TooltipProvider>
      <div
        aria-label="Conversation timeline"
        className={cn("stg:relative stg:flex stg:min-h-0 stg:flex-1 stg:flex-col", className)}
      >
        <div
          ref={scrollRef}
          className="stg:min-h-0 stg:flex-1 stg:overflow-y-auto stg:[overflow-anchor:none] stg:px-4 stg:py-3"
        >
          {!showsCustomerMessages && descriptor && (
            <div className="stg:mb-3 stg:flex stg:items-start stg:gap-2 stg:rounded-md stg:border stg:border-border stg:bg-muted-faint stg:px-3 stg:py-2 stg:text-xs stg:text-muted-foreground">
              <Info aria-hidden="true" className="stg:mt-0.5 stg:size-3.5 stg:shrink-0" />
              <p>
                Customer messages on {descriptor.label} channels aren&apos;t shown
                here yet — this thread has replies, sends, and internal events only.
              </p>
            </div>
          )}

          {isLoading ? (
            <TimelineSkeleton />
          ) : error ? (
            <p className="stg:px-2 stg:py-6 stg:text-center stg:text-sm stg:text-destructive">
              {getUserMessage(error)}
            </p>
          ) : items.length === 0 ? (
            <EmptyState
              variant="first-use"
              icon={<MessageSquare className="stg:size-8" />}
              title="No messages yet"
              description="The conversation's messages appear here as they happen."
            />
          ) : (
            <div ref={contentRef}>
              {hasOlder && (
                <div className="stg:flex stg:justify-center stg:pb-2">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={loadOlder}
                    disabled={isLoadingOlder}
                  >
                    {isLoadingOlder ? "Loading…" : "Load earlier messages"}
                  </Button>
                </div>
              )}
              {days.map((day) => (
                <div key={day.label}>
                  <div
                    className="stg:my-2 stg:text-center stg:text-xs stg:text-muted-foreground-faint"
                    role="separator"
                  >
                    {day.label}
                  </div>
                  <ul className="stg:space-y-1.5">
                    {day.items.map((item) => (
                      <TimelineItemRow
                        key={item.itemId}
                        item={item}
                        agentChannelId={agentChannelId}
                        conversationKey={conversationKey}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <div ref={sentinelRef} aria-hidden="true" />
        </div>
        <JumpToLatestButton visible={!isFollowing} onClick={jumpToLatest} />
      </div>
    </TooltipProvider>
  );
}

const BUSINESS_CAPTION: Record<Exclude<ConversationAuthorKind, "customer">, string> = {
  agent: "Agent",
  teammate: "Teammate",
  platform: "Automated",
  unknown: "Unknown sender",
};

const TimelineItemRow = memo(function TimelineItemRow({
  item,
  agentChannelId,
  conversationKey,
}: {
  readonly item: ConversationTimelineItem;
  readonly agentChannelId?: string;
  readonly conversationKey?: string;
}) {
  if (isInternalItem(item)) {
    return <InternalEventRow item={item} />;
  }

  const author = authorKindOf(item);
  const isCustomer = author === "customer";

  // Ingested media renders as the real thing — an inline thumbnail or
  // document chip — ONLY when the view holds the conversation address
  // (getMediaDownloadUrl's addressing; see the identity props' contract).
  // Without the address, and on media the platform declined to ingest,
  // the typed placeholder keeps telling staff what arrived.
  const mediaAddress =
    item.media !== undefined && agentChannelId && conversationKey
      ? { agentChannelId, conversationKey, itemId: item.itemId }
      : null;
  const body = item.text || (mediaAddress !== null ? "" : inboundPlaceholderOf(item));

  // DD-014 D-c (amended at the Sitting 2 gate, R-1): the provider's
  // failure explanation is decision-bearing — window closed vs bad
  // number changes what the operator does next — so it renders as
  // VISIBLE text, not hover-only (the footer glyphs are deliberately
  // non-focusable per F-18, which makes a tooltip mouse-only). Verbatim
  // relay, never pattern-matched; the numeric twin (receipt_error_code)
  // stays off the surface as machine vocabulary. Gated exactly like
  // ReceiptTicks' failed arm — attempt delivered AND receipt failed —
  // so the attempt-axis explanation (last_error, F-25's slice) can
  // structurally never leak in here.
  const receiptExplanation =
    sendAttemptOf(item) === "delivered" &&
    receiptOf(item) === "failed" &&
    item.receiptDetail !== ""
      ? item.receiptDetail
      : null;

  return (
    <li className={cn("stg:flex", isCustomer ? "stg:justify-start" : "stg:justify-end")}>
      <div
        className={cn(
          "stg:max-w-[80%] stg:rounded-lg stg:px-3 stg:py-2",
          isCustomer ? "stg:bg-muted-subtle" : "stg:bg-primary-subtle",
        )}
      >
        {!isCustomer && (
          <p className="stg:text-xs stg:font-medium stg:text-muted-foreground">
            {BUSINESS_CAPTION[author]}
          </p>
        )}
        {mediaAddress !== null && item.media !== undefined && (
          <ConversationMediaAttachment
            media={item.media}
            address={mediaAddress}
            className={item.text ? "stg:mb-1.5" : undefined}
          />
        )}
        {/* A media item without a caption is complete as its media —
            no body, and no "unavailable" apology under the thumbnail. */}
        {(body || mediaAddress === null) && (
          <p
            className={cn(
              "stg:whitespace-pre-wrap stg:break-words stg:text-sm stg:text-foreground",
              !item.text && "stg:italic stg:text-muted-foreground",
            )}
          >
            {body || "Message content unavailable"}
          </p>
        )}
        {receiptExplanation !== null && (
          <p className="stg:mt-1 stg:break-words stg:text-xs stg:text-destructive">
            {receiptExplanation}
          </p>
        )}
        <ItemFooter item={item} />
      </div>
    </li>
  );
});

/**
 * A footer status glyph with its explanation on the house tooltip
 * (F-18, replacing native `title` — OS-delayed, imprecise, invisible to
 * keyboard and touch). The trigger renders as a plain `<span>` and is
 * deliberately NOT focusable: these sit inside every bubble's footer,
 * so focusable triggers would add several tab stops per message. Their
 * accessible name stays the visible or `sr-only` text; the tooltip is
 * the visual description only.
 */
function StatusHint({
  hint,
  className,
  children,
}: {
  readonly hint: string;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={className} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{hint}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The bubble footer: the item's instant plus, for outbound items, the
 * two status axes — our attempt and the provider's receipt, never
 * collapsed into one glyph.
 */
function ItemFooter({ item }: { readonly item: ConversationTimelineItem }) {
  const attempt = sendAttemptOf(item);
  const time = item.at
    ? timestampDate(item.at).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <p className="stg:mt-1 stg:flex stg:items-center stg:justify-end stg:gap-1 stg:text-xs stg:text-muted-foreground-faint">
      <span>{time}</span>
      {attempt === "failed" && (
        <StatusHint
          hint="The platform could not deliver this message"
          className="stg:flex stg:items-center stg:gap-0.5 stg:text-destructive"
        >
          <TriangleAlert aria-hidden="true" className="stg:size-3" />
          Not delivered
        </StatusHint>
      )}
      {attempt === "suppressed" && (
        <StatusHint
          hint="Withheld because a human had the conversation when it came due"
          className="stg:flex stg:items-center stg:gap-0.5"
        >
          <Ban aria-hidden="true" className="stg:size-3" />
          Held
        </StatusHint>
      )}
      {(attempt === "pending" || attempt === "delivering") && (
        <StatusHint hint="Sending" className="stg:flex stg:items-center stg:gap-0.5">
          <Clock aria-hidden="true" className="stg:size-3" />
          <span className="stg:sr-only">Sending</span>
        </StatusHint>
      )}
      {attempt === "delivered" && <ReceiptTicks item={item} />}
    </p>
  );
}

/**
 * The provider's receipt report, WhatsApp-tick style. Renders only on
 * items the platform successfully handed to the provider; the receipt
 * can still be `failed` — the "we sent it, it never arrived" case a
 * collapsed status hides.
 */
function ReceiptTicks({ item }: { readonly item: ConversationTimelineItem }) {
  const receipt = receiptOf(item);
  if (receipt === "failed") {
    return (
      <StatusHint
        hint="The provider accepted this message but could not deliver it"
        className="stg:flex stg:items-center stg:gap-0.5 stg:text-destructive"
      >
        <TriangleAlert aria-hidden="true" className="stg:size-3" />
        Delivery failed
      </StatusHint>
    );
  }
  if (receipt === "read") {
    return (
      <StatusHint hint="Read by the customer" className="stg:text-primary">
        <CheckCheck aria-hidden="true" className="stg:size-3.5" />
        <span className="stg:sr-only">Read</span>
      </StatusHint>
    );
  }
  if (receipt === "delivered") {
    return (
      <StatusHint hint="Delivered to the customer's device">
        <CheckCheck aria-hidden="true" className="stg:size-3.5" />
        <span className="stg:sr-only">Delivered</span>
      </StatusHint>
    );
  }
  // Handed to the provider; no (further) receipt yet.
  return (
    <StatusHint hint="Sent">
      <Check aria-hidden="true" className="stg:size-3.5" />
      <span className="stg:sr-only">Sent</span>
    </StatusHint>
  );
}

/**
 * Internal-lane rows — org-internal events the customer never saw,
 * rendered as centered system copy so they can never be misread as
 * messages: the agent's escalation (its reason verbatim) and a
 * teammate's attention clear.
 */
function InternalEventRow({ item }: { readonly item: ConversationTimelineItem }) {
  const author = authorKindOf(item);
  const isEscalation = author === "agent" && item.text !== "";

  return (
    <li className="stg:flex stg:justify-center">
      <div
        className={cn(
          "stg:flex stg:max-w-[90%] stg:items-start stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-center stg:text-xs",
          isEscalation
            ? "stg:bg-destructive-subtle stg:text-destructive"
            : "stg:bg-muted-faint stg:text-muted-foreground",
        )}
      >
        {isEscalation ? (
          <>
            <TriangleAlert aria-hidden="true" className="stg:mt-0.5 stg:size-3.5 stg:shrink-0" />
            <span className="stg:min-w-0 stg:break-words">
              Agent escalated to a human — “{item.text}”
            </span>
          </>
        ) : item.text !== "" ? (
          // A future internal note flows through with zero code change.
          <span className="stg:min-w-0 stg:break-words">{item.text}</span>
        ) : (
          <span>A teammate resolved the attention flag</span>
        )}
      </div>
    </li>
  );
}

function TimelineSkeleton() {
  return (
    <div className="stg:space-y-2" aria-hidden="true">
      <div className="stg:h-10 stg:w-3/5 stg:animate-pulse stg:rounded-lg stg:bg-muted-faint" />
      <div className="stg:ml-auto stg:h-10 stg:w-3/5 stg:animate-pulse stg:rounded-lg stg:bg-muted-faint" />
      <div className="stg:h-10 stg:w-2/5 stg:animate-pulse stg:rounded-lg stg:bg-muted-faint" />
    </div>
  );
}

interface DayGroup {
  readonly label: string;
  readonly items: readonly ConversationTimelineItem[];
}

/** Group chronological items under day separators. */
function groupByDay(
  items: readonly ConversationTimelineItem[],
  now?: Date,
): readonly DayGroup[] {
  const ref = now ?? new Date();
  const groups: { label: string; items: ConversationTimelineItem[] }[] = [];
  let currentKey = "";
  for (const item of items) {
    const date = item.at ? timestampDate(item.at) : null;
    const key = date ? date.toDateString() : "undated";
    if (key !== currentKey) {
      currentKey = key;
      groups.push({ label: date ? dayLabel(date, ref) : "Earlier", items: [] });
    }
    groups[groups.length - 1].items.push(item);
  }
  return groups;
}

function dayLabel(date: Date, ref: Date): string {
  if (date.toDateString() === ref.toDateString()) return "Today";
  const yesterday = new Date(ref);
  yesterday.setDate(ref.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === ref.getFullYear() ? {} : { year: "numeric" }),
  });
}

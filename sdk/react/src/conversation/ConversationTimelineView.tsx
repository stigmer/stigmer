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
import { useAutoScroll } from "../internal/useAutoScroll.js";
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
    <div
      aria-label="Conversation timeline"
      className={cn("relative flex min-h-0 flex-1 flex-col", className)}
    >
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto [overflow-anchor:none] px-4 py-3"
      >
        {!showsCustomerMessages && descriptor && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-border bg-muted-faint px-3 py-2 text-xs text-muted-foreground">
            <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <p>
              Customer messages on {descriptor.label} channels aren&apos;t shown
              here yet — this thread has replies, sends, and internal events only.
            </p>
          </div>
        )}

        {isLoading ? (
          <TimelineSkeleton />
        ) : error ? (
          <p className="px-2 py-6 text-center text-sm text-destructive">
            {getUserMessage(error)}
          </p>
        ) : items.length === 0 ? (
          <EmptyState
            variant="first-use"
            icon={<MessageSquare className="size-8" />}
            title="No messages yet"
            description="The conversation's messages appear here as they happen."
          />
        ) : (
          <div ref={contentRef}>
            {hasOlder && (
              <div className="flex justify-center pb-2">
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
                  className="my-2 text-center text-xs text-muted-foreground-faint"
                  role="separator"
                >
                  {day.label}
                </div>
                <ul className="space-y-1.5">
                  {day.items.map((item) => (
                    <TimelineItemRow key={item.itemId} item={item} />
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
}: {
  readonly item: ConversationTimelineItem;
}) {
  if (isInternalItem(item)) {
    return <InternalEventRow item={item} />;
  }

  const author = authorKindOf(item);
  const isCustomer = author === "customer";
  const body = item.text || inboundPlaceholderOf(item);

  return (
    <li className={cn("flex", isCustomer ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-3 py-2",
          isCustomer ? "bg-muted-subtle" : "bg-primary-subtle",
        )}
      >
        {!isCustomer && (
          <p className="text-xs font-medium text-muted-foreground">
            {BUSINESS_CAPTION[author]}
          </p>
        )}
        <p
          className={cn(
            "whitespace-pre-wrap break-words text-sm text-foreground",
            !item.text && "italic text-muted-foreground",
          )}
        >
          {body || "Message content unavailable"}
        </p>
        <ItemFooter item={item} />
      </div>
    </li>
  );
});

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
    <p className="mt-1 flex items-center justify-end gap-1 text-xs text-muted-foreground-faint">
      <span>{time}</span>
      {attempt === "failed" && (
        <span className="flex items-center gap-0.5 text-destructive" title="The platform could not deliver this message">
          <TriangleAlert aria-hidden="true" className="size-3" />
          Not delivered
        </span>
      )}
      {attempt === "suppressed" && (
        <span
          className="flex items-center gap-0.5"
          title="Withheld because a human had the conversation when it came due"
        >
          <Ban aria-hidden="true" className="size-3" />
          Held
        </span>
      )}
      {(attempt === "pending" || attempt === "delivering") && (
        <span className="flex items-center gap-0.5" title="Sending">
          <Clock aria-hidden="true" className="size-3" />
          <span className="sr-only">Sending</span>
        </span>
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
      <span
        className="flex items-center gap-0.5 text-destructive"
        title="The provider accepted this message but could not deliver it"
      >
        <TriangleAlert aria-hidden="true" className="size-3" />
        Delivery failed
      </span>
    );
  }
  if (receipt === "read") {
    return (
      <span title="Read by the customer" className="text-primary">
        <CheckCheck aria-hidden="true" className="size-3.5" />
        <span className="sr-only">Read</span>
      </span>
    );
  }
  if (receipt === "delivered") {
    return (
      <span title="Delivered to the customer's device">
        <CheckCheck aria-hidden="true" className="size-3.5" />
        <span className="sr-only">Delivered</span>
      </span>
    );
  }
  // Handed to the provider; no (further) receipt yet.
  return (
    <span title="Sent">
      <Check aria-hidden="true" className="size-3.5" />
      <span className="sr-only">Sent</span>
    </span>
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
    <li className="flex justify-center">
      <div
        className={cn(
          "flex max-w-[90%] items-start gap-1.5 rounded-md px-3 py-1.5 text-center text-xs",
          isEscalation
            ? "bg-destructive-subtle text-destructive"
            : "bg-muted-faint text-muted-foreground",
        )}
      >
        {isEscalation ? (
          <>
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 break-words">
              Agent escalated to a human — “{item.text}”
            </span>
          </>
        ) : item.text !== "" ? (
          // A future internal note flows through with zero code change.
          <span className="min-w-0 break-words">{item.text}</span>
        ) : (
          <span>A teammate resolved the attention flag</span>
        )}
      </div>
    </li>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      <div className="h-10 w-3/5 animate-pulse rounded-lg bg-muted-faint" />
      <div className="ml-auto h-10 w-3/5 animate-pulse rounded-lg bg-muted-faint" />
      <div className="h-10 w-2/5 animate-pulse rounded-lg bg-muted-faint" />
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

"use client";

import { create, equals } from "@bufbuild/protobuf";
import type { ConversationTimelineItem } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import {
  ConversationTimelineItemSchema,
  GetConversationTimelineInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { useFetch } from "../internal/useFetch.js";
import { compareTimelineItemsNewestFirst } from "./conversationPresentation.js";
import { CONVERSATION_DETAIL_POLL_INTERVAL_MS } from "./polling.js";

/** Options for {@link useConversationTimeline}. */
export interface UseConversationTimelineOptions {
  /** Items per page, for the polled head and each loadOlder page. Default 50. */
  readonly pageSize?: number;
  /**
   * Poll interval in milliseconds; `false` disables polling. Defaults to
   * {@link CONVERSATION_DETAIL_POLL_INTERVAL_MS}. Only the head page
   * polls — it is where new items land and where recent items' delivery
   * and receipt states still move.
   */
  readonly refetchIntervalMs?: number | false;
}

/** Return value of {@link useConversationTimeline}. */
export interface UseConversationTimelineReturn {
  /**
   * Every item seen so far, in chronological (oldest → newest) order —
   * the render order of a chat view. Items are never dropped: the polled
   * head window may shift as new messages land, and an item that slides
   * out of it stays here rather than vanishing mid-scroll.
   */
  readonly items: readonly ConversationTimelineItem[];
  /**
   * `true` while older history exists beyond what is loaded. Decided
   * ONLY by the server's cursor — a short page mid-history is normal
   * (same-second bursts narrow pages) and never means the end.
   */
  readonly hasOlder: boolean;
  /** Load the next older page. No-op while one is already loading. */
  readonly loadOlder: () => void;
  /** `true` while a loadOlder page is in flight. */
  readonly isLoadingOlder: boolean;
  /** Error from the last failed loadOlder, or `null`. Cleared on retry. */
  readonly loadOlderError: Error | null;
  /** `true` only during the first head-page load. */
  readonly isLoading: boolean;
  /** `true` while the head page refreshes in the background. */
  readonly isRefetching: boolean;
  /** Error from the last failed head-page fetch, or `null`. */
  readonly error: Error | null;
  /** Re-fetch the head page. */
  readonly refetch: () => void;
}

interface HeadPage {
  readonly items: readonly ConversationTimelineItem[];
  readonly nextPageToken: string;
}

const EMPTY_HEAD: HeadPage = { items: [], nextPageToken: "" };

/**
 * Data hook for one conversation's customer-visible timeline
 * (channel-conversations DD-004): newest-first cursor pages from the
 * server, accumulated into one chronological list for a chat view.
 *
 * The accumulation is an UPSERT by `item_id`, not head/tail
 * concatenation, for two verified server behaviors:
 *
 * - Item instants are stable but STATUSES mutate in place — an outbound
 *   item's delivery status and receipt ticks advance after it first
 *   renders. Each head poll re-upserts the newest window, so those
 *   fields stay live without any diffing protocol.
 * - The head window SHIFTS as new items land. Items that slide out of
 *   it are not in any loaded older page (older cursors are anchored
 *   below the original head), so concatenation would silently drop
 *   them; the upsert map keeps everything ever seen.
 *
 * The older cursor is captured from the FIRST head page only: later
 * head refreshes serve the top of the timeline, while the cursor tracks
 * how deep into history the consumer has scrolled — two independent
 * frontiers. Receipt ticks on items deeper than the head window can go
 * stale until the conversation is reopened; accepted for v1 (the T05
 * liveness seam is where per-item freshness lands).
 *
 * Pass empty strings to skip fetching (the `null`-fetchFn convention).
 */
export function useConversationTimeline(
  agentChannelId: string,
  conversationKey: string,
  options?: UseConversationTimelineOptions,
): UseConversationTimelineReturn {
  const pageSize = options?.pageSize ?? 50;
  const refetchIntervalMs =
    options?.refetchIntervalMs ?? CONVERSATION_DETAIL_POLL_INTERVAL_MS;
  const stigmer = useStigmer();

  const enabled = agentChannelId !== "" && conversationKey !== "";

  const fetchFn = enabled
    ? async (): Promise<HeadPage> => {
        const result = await stigmer.agentChannel.getTimeline(
          create(GetConversationTimelineInputSchema, {
            agentChannelId,
            conversationKey,
            pageSize,
          }),
        );
        return { items: result.items, nextPageToken: result.nextPageToken };
      }
    : null;

  const {
    data: head,
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useFetch(fetchFn, [agentChannelId, conversationKey, pageSize, stigmer], EMPTY_HEAD, {
    refetchInterval: refetchIntervalMs,
  });

  // Everything ever seen for this conversation, by item id.
  const [known, setKnown] = useState<ReadonlyMap<string, ConversationTimelineItem>>(
    new Map(),
  );
  // The older-history frontier: null until the first head page answers,
  // "" once history is exhausted, otherwise the next older cursor.
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [loadOlderError, setLoadOlderError] = useState<Error | null>(null);
  const epochRef = useRef(0);

  useEffect(() => {
    epochRef.current += 1;
    setKnown(new Map());
    setOlderCursor(null);
    setIsLoadingOlder(false);
    setLoadOlderError(null);
  }, [agentChannelId, conversationKey, pageSize, stigmer]);

  // Fold each head page into the map. `head` is referentially fresh per
  // fetch, so this runs exactly once per answer.
  useEffect(() => {
    if (head === EMPTY_HEAD) return;
    setKnown((current) => upsert(current, head.items));
    setOlderCursor((current) => (current === null ? head.nextPageToken : current));
  }, [head]);

  const loadOlder = useCallback(() => {
    if (!enabled || isLoadingOlder || !olderCursor) return;
    const epoch = epochRef.current;
    setIsLoadingOlder(true);
    setLoadOlderError(null);

    stigmer.agentChannel
      .getTimeline(
        create(GetConversationTimelineInputSchema, {
          agentChannelId,
          conversationKey,
          pageSize,
          pageToken: olderCursor,
        }),
      )
      .then(
        (result) => {
          if (epochRef.current !== epoch) return;
          setKnown((current) => upsert(current, result.items));
          setOlderCursor(result.nextPageToken);
          setIsLoadingOlder(false);
        },
        (err) => {
          if (epochRef.current !== epoch) return;
          setLoadOlderError(toError(err));
          setIsLoadingOlder(false);
        },
      );
  }, [enabled, isLoadingOlder, olderCursor, agentChannelId, conversationKey, pageSize, stigmer]);

  const items = useMemo(
    () =>
      Array.from(known.values())
        .sort(compareTimelineItemsNewestFirst)
        .reverse(),
    [known],
  );

  const hasOlder = olderCursor !== null && olderCursor !== "";

  return useMemo(
    () => ({
      items,
      hasOlder,
      loadOlder,
      isLoadingOlder,
      loadOlderError,
      isLoading,
      isRefetching,
      error,
      refetch,
    }),
    [
      items,
      hasOlder,
      loadOlder,
      isLoadingOlder,
      loadOlderError,
      isLoading,
      isRefetching,
      error,
      refetch,
    ],
  );
}

/**
 * Fold a page into the map, preserving references: a poll returns fresh
 * proto objects even when nothing changed, and swapping equal items
 * would defeat `React.memo` on every row every poll tick (DD-010 —
 * reference stability is architectural, not an optimization). An
 * unchanged page returns the SAME map, so the sorted `items` memo does
 * not even re-run.
 */
function upsert(
  current: ReadonlyMap<string, ConversationTimelineItem>,
  incoming: readonly ConversationTimelineItem[],
): ReadonlyMap<string, ConversationTimelineItem> {
  let next: Map<string, ConversationTimelineItem> | null = null;
  for (const item of incoming) {
    const existing = current.get(item.itemId);
    if (existing && equals(ConversationTimelineItemSchema, existing, item)) continue;
    next ??= new Map(current);
    next.set(item.itemId, item);
  }
  return next ?? current;
}

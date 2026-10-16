"use client";

import { create } from "@bufbuild/protobuf";
import type { ChannelConversation } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/conversation_io_pb";
import {
  ChannelConversationListFilter,
  ListChannelConversationsInputSchema,
} from "@stigmer/apis/ai/stigmer/agentic/channel/v1/conversation_io_pb";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { useFetch } from "../internal/useFetch.js";
import { CONVERSATION_LIST_POLL_INTERVAL_MS } from "./polling.js";

/** Options for {@link useConversationList}. */
export interface UseConversationListOptions {
  /** Organization whose conversations to list. `null` skips fetching. */
  readonly org: string | null;
  /** Optional filter: only conversations on this agent channel. */
  readonly channelId?: string;
  /**
   * Optional server-evaluated predicate filter. The generated enum is
   * the vocabulary on purpose — the predicate lives in ONE place, the
   * server, and the hook never re-expresses it. Defaults to
   * unspecified (no filter).
   */
  readonly filter?: ChannelConversationListFilter;
  /** Page size for the head page and each loadMore page. Default 50. */
  readonly pageSize?: number;
  /**
   * Poll interval in milliseconds; `false` disables polling. Defaults to
   * {@link CONVERSATION_LIST_POLL_INTERVAL_MS}. Only the head page polls
   * — loaded older pages refresh on the next full identity change.
   */
  readonly refetchIntervalMs?: number | false;
}

/** Return value of {@link useConversationList}. */
export interface UseConversationListReturn {
  /**
   * Conversations, newest activity first: the polled head page followed
   * by the accumulated older pages, deduplicated by conversation
   * identity (a conversation that gains activity while older pages load
   * moves to the head, and appears once, in its head position), with any
   * {@link applyServerState} rows overriding both. A list carries no
   * total; the inbox badge counts through `useConversationsWantsHumanCount`.
   */
  readonly conversations: readonly ChannelConversation[];
  /** `true` while more conversations exist beyond what is loaded. */
  readonly hasMore: boolean;
  /** Load the next older page. No-op while one is already loading. */
  readonly loadMore: () => void;
  /** `true` while a loadMore page is in flight. */
  readonly isLoadingMore: boolean;
  /** Error from the last failed loadMore, or `null`. Cleared on retry. */
  readonly loadMoreError: Error | null;
  /** `true` only during the first head-page load. */
  readonly isLoading: boolean;
  /** `true` while the head page refreshes in the background. */
  readonly isRefetching: boolean;
  /** Error from the last failed head-page fetch, or `null`. */
  readonly error: Error | null;
  /** Re-fetch the head page. */
  readonly refetch: () => void;
  /**
   * Adopt a fresh row the server just returned — every participation
   * command answers the post-command state, and that answer is newer
   * than anything a poll already in flight will deliver (your own
   * action reflects immediately, zero polls involved). The row
   * overrides the listed copy for exactly one round-trip: applying also
   * starts a fresh head fetch, and the override is dropped when a page
   * provably fetched after the apply answers.
   */
  readonly applyServerState: (fresh: ChannelConversation) => void;
}

interface HeadPage {
  readonly items: readonly ChannelConversation[];
  /** The token after the head page; `""` when it is the whole list. */
  readonly nextPageToken: string;
  /**
   * The apply-sequence at the moment this fetch STARTED. The overlay
   * (see {@link useConversationList}) may only be cleared by a page
   * whose `seq` proves it observed the post-command server state.
   */
  readonly seq: number;
}

const EMPTY_HEAD: HeadPage = { items: [], nextPageToken: "", seq: 0 };

/** Older pages loaded after the head, and the token after the last of them. */
interface OlderPages {
  readonly pages: readonly (readonly ChannelConversation[])[];
  readonly nextPageToken: string;
}

/** Rows adopted from command answers, waiting for the head to catch up. */
interface Overlay {
  readonly rows: ReadonlyMap<string, ChannelConversation>;
  /** The apply-sequence of the newest apply in {@link rows}. */
  readonly seq: number;
}

const EMPTY_OVERLAY: Overlay = { rows: new Map(), seq: 0 };

function identityOf(conversation: ChannelConversation): string {
  return `${conversation.channelId}\u0000${conversation.conversationKey}`;
}

/** Activity instant in epoch milliseconds, for sorted overlay inserts. */
function activityMillisOf(conversation: ChannelConversation): number {
  const at = conversation.lastActivityAt;
  if (!at) return 0;
  return Number(at.seconds) * 1_000 + Math.floor(at.nanos / 1_000_000);
}

/**
 * Data hook for the org-wide conversation list: newest activity first
 * across every channel the caller can view, optionally narrowed to one
 * channel and/or a server-evaluated predicate ({@link
 * ChannelConversationListFilter}).
 *
 * The head page rides `useFetch` and polls; older pages accumulate via
 * {@link UseConversationListReturn.loadMore}, each continuing from the
 * token after the last one loaded, and are merged with head precedence —
 * a conversation that gains activity moves above the pages already read,
 * so identity dedup (head copy wins: it is the fresher read) is what
 * keeps a moving conversation from rendering twice.
 *
 * Command answers enter through
 * {@link UseConversationListReturn.applyServerState} as a short-lived
 * OVERLAY rather than a write into the fetched state, because `useFetch`
 * has no write fence (the reason `useConversation` is hand-rolled): a
 * poll answer already in the microtask queue when the command answers can
 * commit AFTER the apply, and clearing the adopted row on "any head
 * change" would hand the inbox back to pre-command state for a full poll
 * period. Instead every head page is stamped with the apply-sequence at
 * fetch start, and the overlay is dropped only when a page with
 * `seq >= overlay.seq` — one provably started after the apply — answers.
 * Applying triggers that fetch immediately, so the overlay lives for
 * exactly one round-trip.
 *
 * Two honesty guards on overlay INSERTS (rows the server has not listed):
 * a row from another channel never enters a channel-scoped list (identity
 * equality — the same scope the hook sends to the server), and under a
 * server-evaluated predicate filter the overlay is update-only, because
 * the client cannot honestly claim membership the server has not
 * asserted (the predicate lives once, on the server). Updates in place
 * are always honest: the server listed the row.
 */
export function useConversationList(
  options: UseConversationListOptions,
): UseConversationListReturn {
  const {
    org,
    channelId = "",
    filter = ChannelConversationListFilter.channel_conversation_list_filter_unspecified,
    pageSize = 50,
  } = options;
  const refetchIntervalMs =
    options.refetchIntervalMs ?? CONVERSATION_LIST_POLL_INTERVAL_MS;
  const stigmer = useStigmer();

  // Monotonic count of applyServerState calls; head pages carry the
  // value read at their fetch start (see HeadPage.seq).
  const applySeqRef = useRef(0);

  const fetchFn = org
    ? async (): Promise<HeadPage> => {
        const seq = applySeqRef.current;
        const result = await stigmer.channel.listConversations(
          create(ListChannelConversationsInputSchema, {
            org,
            channelId,
            filter,
            pageSize,
          }),
        );
        return { items: result.entries, nextPageToken: result.nextPageToken, seq };
      }
    : null;

  const {
    data: head,
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useFetch(
    fetchFn,
    [org, channelId, filter, pageSize, stigmer],
    EMPTY_HEAD,
    {
      refetchInterval: refetchIntervalMs,
      // Returning to the tab is fresh.
      refetchOnWindowFocus: true,
    },
  );

  // Older pages, keyed by the same identity deps as the head fetch; the
  // epoch fences in-flight loadMore answers across an identity change.
  const [older, setOlder] = useState<OlderPages | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<Error | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(EMPTY_OVERLAY);
  const epochRef = useRef(0);

  useEffect(() => {
    epochRef.current += 1;
    setOlder(null);
    setIsLoadingMore(false);
    setLoadMoreError(null);
    setOverlay(EMPTY_OVERLAY);
  }, [org, channelId, filter, pageSize, stigmer]);

  const applyServerState = useCallback(
    (fresh: ChannelConversation) => {
      const seq = ++applySeqRef.current;
      setOverlay((current) => {
        const rows = new Map(current.rows);
        rows.set(identityOf(fresh), fresh);
        return { rows, seq };
      });
      // Starts the round-trip that retires the overlay; also cancels any
      // in-flight pre-command head fetch (useFetch's cleanup semantics).
      refetch();
    },
    [refetch],
  );

  // Retire the overlay once a head page fetched after the newest apply
  // answers — server truth has caught up. A page with an older stamp
  // (the microtask-race case) keeps the overlay in force.
  useEffect(() => {
    if (overlay.rows.size === 0) return;
    if (head.seq >= overlay.seq) setOverlay(EMPTY_OVERLAY);
  }, [head, overlay]);

  // The token after the last page loaded: the head's until an older page
  // arrives, then that page's.
  const tailToken = older !== null ? older.nextPageToken : head.nextPageToken;

  const loadMore = useCallback(() => {
    if (!org || isLoadingMore || tailToken === "") return;
    const epoch = epochRef.current;
    setIsLoadingMore(true);
    setLoadMoreError(null);

    stigmer.channel
      .listConversations(
        create(ListChannelConversationsInputSchema, {
          org,
          channelId,
          filter,
          pageSize,
          pageToken: tailToken,
        }),
      )
      .then(
        (result) => {
          if (epochRef.current !== epoch) return;
          setOlder((current) => ({
            pages: [...(current?.pages ?? []), result.entries],
            nextPageToken: result.nextPageToken,
          }));
          setIsLoadingMore(false);
        },
        (err) => {
          if (epochRef.current !== epoch) return;
          setLoadMoreError(toError(err));
          setIsLoadingMore(false);
        },
      );
  }, [org, channelId, filter, pageSize, stigmer, isLoadingMore, tailToken]);

  const conversations = useMemo(() => {
    const seen = new Set<string>();
    const merged: ChannelConversation[] = [];
    for (const conversation of [...head.items, ...(older?.pages.flat() ?? [])]) {
      const identity = identityOf(conversation);
      if (seen.has(identity)) continue;
      seen.add(identity);
      // Update-in-place is always honest: the server listed this row.
      merged.push(overlay.rows.get(identity) ?? conversation);
    }
    // Overlay rows the server has not listed: sorted insert (a command
    // answer is not a recency claim — a takeover does not advance the
    // activity clock, so head-of-list would misorder), subject to the
    // two honesty guards documented on the hook.
    for (const [identity, fresh] of overlay.rows) {
      if (seen.has(identity)) continue;
      if (
        filter !==
        ChannelConversationListFilter.channel_conversation_list_filter_unspecified
      ) {
        continue;
      }
      if (channelId !== "" && fresh.channelId !== channelId) {
        continue;
      }
      const at = activityMillisOf(fresh);
      const index = merged.findIndex((c) => activityMillisOf(c) < at);
      merged.splice(index === -1 ? merged.length : index, 0, fresh);
      seen.add(identity);
    }
    return merged;
  }, [head.items, older, overlay, channelId, filter]);

  const hasMore = tailToken !== "";

  return useMemo(
    () => ({
      conversations,
      hasMore,
      loadMore,
      isLoadingMore,
      loadMoreError,
      isLoading,
      isRefetching,
      error,
      refetch,
      applyServerState,
    }),
    [
      conversations,
      hasMore,
      loadMore,
      isLoadingMore,
      loadMoreError,
      isLoading,
      isRefetching,
      error,
      refetch,
      applyServerState,
    ],
  );
}

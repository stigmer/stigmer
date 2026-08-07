"use client";

import { create } from "@bufbuild/protobuf";
import type { ChannelConversation } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { ListChannelConversationsInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
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
  readonly agentChannelId?: string;
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
   * identity (offset pages drift under live activity — a conversation
   * that moved up between fetches appears once, in its head position).
   */
  readonly conversations: readonly ChannelConversation[];
  /** Exact total for the current filter, from the server. */
  readonly totalCount: number;
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
}

interface HeadPage {
  readonly items: readonly ChannelConversation[];
  readonly totalCount: number;
}

const EMPTY_HEAD: HeadPage = { items: [], totalCount: 0 };

function identityOf(conversation: ChannelConversation): string {
  return `${conversation.agentChannelId}\u0000${conversation.conversationKey}`;
}

/**
 * Data hook for the org-wide conversation list (channel-conversations
 * DD-004): newest activity first across every channel the caller can
 * view, optionally filtered to one channel.
 *
 * The head page rides `useFetch` and polls; older pages accumulate via
 * {@link UseConversationListReturn.loadMore} and are merged with head
 * precedence — the server's offset pagination shifts under live activity,
 * so identity dedup (head copy wins: it is the fresher read) is what
 * keeps a moving conversation from rendering twice.
 */
export function useConversationList(
  options: UseConversationListOptions,
): UseConversationListReturn {
  const { org, agentChannelId = "", pageSize = 50 } = options;
  const refetchIntervalMs =
    options.refetchIntervalMs ?? CONVERSATION_LIST_POLL_INTERVAL_MS;
  const stigmer = useStigmer();

  const fetchFn = org
    ? async (): Promise<HeadPage> => {
        const result = await stigmer.agentChannel.listConversations(
          create(ListChannelConversationsInputSchema, {
            org,
            agentChannelId,
            pageInfo: { num: 1, size: pageSize },
          }),
        );
        return { items: result.items, totalCount: result.totalCount };
      }
    : null;

  const {
    data: head,
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useFetch(fetchFn, [org, agentChannelId, pageSize, stigmer], EMPTY_HEAD, {
    refetchInterval: refetchIntervalMs,
  });

  // Older pages, keyed by the same identity deps as the head fetch; the
  // epoch fences in-flight loadMore answers across an identity change.
  const [olderPages, setOlderPages] = useState<readonly ChannelConversation[][]>([]);
  const [loadedThroughPage, setLoadedThroughPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<Error | null>(null);
  const epochRef = useRef(0);

  useEffect(() => {
    epochRef.current += 1;
    setOlderPages([]);
    setLoadedThroughPage(1);
    setIsLoadingMore(false);
    setLoadMoreError(null);
  }, [org, agentChannelId, pageSize, stigmer]);

  const loadMore = useCallback(() => {
    if (!org || isLoadingMore) return;
    const epoch = epochRef.current;
    const nextPage = loadedThroughPage + 1;
    setIsLoadingMore(true);
    setLoadMoreError(null);

    stigmer.agentChannel
      .listConversations(
        create(ListChannelConversationsInputSchema, {
          org,
          agentChannelId,
          pageInfo: { num: nextPage, size: pageSize },
        }),
      )
      .then(
        (result) => {
          if (epochRef.current !== epoch) return;
          setOlderPages((pages) => [...pages, result.items]);
          setLoadedThroughPage(nextPage);
          setIsLoadingMore(false);
        },
        (err) => {
          if (epochRef.current !== epoch) return;
          setLoadMoreError(toError(err));
          setIsLoadingMore(false);
        },
      );
  }, [org, agentChannelId, pageSize, stigmer, isLoadingMore, loadedThroughPage]);

  const conversations = useMemo(() => {
    const seen = new Set<string>();
    const merged: ChannelConversation[] = [];
    for (const conversation of [...head.items, ...olderPages.flat()]) {
      const identity = identityOf(conversation);
      if (seen.has(identity)) continue;
      seen.add(identity);
      merged.push(conversation);
    }
    return merged;
  }, [head.items, olderPages]);

  const hasMore = conversations.length < head.totalCount;

  return useMemo(
    () => ({
      conversations,
      totalCount: head.totalCount,
      hasMore,
      loadMore,
      isLoadingMore,
      loadMoreError,
      isLoading,
      isRefetching,
      error,
      refetch,
    }),
    [
      conversations,
      head.totalCount,
      hasMore,
      loadMore,
      isLoadingMore,
      loadMoreError,
      isLoading,
      isRefetching,
      error,
      refetch,
    ],
  );
}

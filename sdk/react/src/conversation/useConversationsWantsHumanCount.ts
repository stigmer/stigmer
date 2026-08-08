"use client";

import { create } from "@bufbuild/protobuf";
import {
  ChannelConversationListFilter,
  ListChannelConversationsInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { useMemo } from "react";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { CONVERSATION_BADGE_POLL_INTERVAL_MS } from "./polling.js";

/** Options for {@link useConversationsWantsHumanCount}. */
export interface UseConversationsWantsHumanCountOptions {
  /**
   * Poll interval in milliseconds; `false` disables polling. Defaults to
   * {@link CONVERSATION_BADGE_POLL_INTERVAL_MS} — deliberately the
   * slowest budget on the conversation surface (DD-012 D-b): a badge
   * tolerates staleness an open inbox does not, and it renders on every
   * console page in every tab.
   */
  readonly refetchIntervalMs?: number | false;
}

/** Return value of {@link useConversationsWantsHumanCount}. */
export interface UseConversationsWantsHumanCountReturn {
  /**
   * Conversations where a human action is wanted:
   * `needs_attention OR (awaiting_reply AND human-held)` — the two ways
   * a conversation can be blocked on a person (the agent asked for one,
   * or a human took over and the customer wrote). `0` until the first
   * answer.
   */
  readonly count: number;
  /** `true` only until the first answer arrives. */
  readonly isLoading: boolean;
  /** Error from the last failed read, or `null`. */
  readonly error: Error | null;
  /** Imperatively re-read the count. */
  readonly refetch: () => void;
}

/**
 * Data hook for the sidebar's Conversations badge (channel-conversations
 * DD-011 D-f): how many conversations want a human right now, org-wide.
 *
 * The count IS the filtered list's `total_count` — one page-size-1 read
 * with `filter_wants_human`, zero dedicated RPCs (DD-011 D-g). Because
 * the badge and the wants-human list filter share one server-side
 * predicate, the number shown and the list it leads to can never
 * disagree.
 *
 * Pass `null` to skip fetching (no active org).
 */
export function useConversationsWantsHumanCount(
  org: string | null,
  options?: UseConversationsWantsHumanCountOptions,
): UseConversationsWantsHumanCountReturn {
  const stigmer = useStigmer();
  const refetchIntervalMs =
    options?.refetchIntervalMs ?? CONVERSATION_BADGE_POLL_INTERVAL_MS;

  const fetchFn = org
    ? async (): Promise<number> => {
        const result = await stigmer.agentChannel.listConversations(
          create(ListChannelConversationsInputSchema, {
            org,
            filter: ChannelConversationListFilter.filter_wants_human,
            pageInfo: { num: 1, size: 1 },
          }),
        );
        return result.totalCount;
      }
    : null;

  const { data, isLoading, error, refetch } = useFetch(fetchFn, [org, stigmer], 0, {
    refetchInterval: refetchIntervalMs,
    // DD-012 D-a: returning to the tab is fresh.
    refetchOnWindowFocus: true,
  });

  return useMemo(
    () => ({ count: data, isLoading, error, refetch }),
    [data, isLoading, error, refetch],
  );
}

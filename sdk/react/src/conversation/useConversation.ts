"use client";

import { create, equals } from "@bufbuild/protobuf";
import { isNotFound } from "@stigmer/sdk";
import type { ChannelConversation } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import {
  ChannelConversationSchema,
  GetChannelConversationInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { CONVERSATION_DETAIL_POLL_INTERVAL_MS } from "./polling.js";

/** Options for {@link useConversation}. */
export interface UseConversationOptions {
  /**
   * Poll interval in milliseconds; `false` disables polling. Defaults to
   * {@link CONVERSATION_DETAIL_POLL_INTERVAL_MS} — the open conversation
   * is where another teammate's takeover must appear promptly.
   */
  readonly refetchIntervalMs?: number | false;
}

/** Return value of {@link useConversation}. */
export interface UseConversationReturn {
  /**
   * The conversation's participation state, or `null` while loading and
   * while the conversation does not exist yet (see
   * {@link awaitingCustomer} for the distinction).
   */
  readonly conversation: ChannelConversation | null;
  /**
   * `true` when the server answered NOT_FOUND: no conversation row
   * exists yet for this key. NOT an error — a proactive cold-send can
   * have a timeline before the customer ever writes, and the row is
   * created by the customer's first message. Render it as
   * "participation controls unlock when the customer writes".
   */
  readonly awaitingCustomer: boolean;
  /** `true` only until the first answer (row or NOT_FOUND) arrives. */
  readonly isLoading: boolean;
  /** `true` while a background poll is in flight and stale state shows. */
  readonly isRefetching: boolean;
  /** Error from the last failed request (NOT_FOUND excluded), or `null`. */
  readonly error: Error | null;
  /** Imperatively re-read the row. */
  readonly refetch: () => void;
  /**
   * Adopt a fresh row the server just returned — every participation
   * command answers the post-command state (including for the loser of
   * a concurrent-takeover race), and that answer is newer than anything
   * a poll already in flight will deliver. Applying it also fences
   * those in-flight polls so a stale answer can never overwrite it.
   */
  readonly applyServerState: (fresh: ChannelConversation) => void;
}

/**
 * Data hook for one conversation's identity and participation state —
 * the single-row read behind a conversation detail view (who holds
 * control, whether attention is needed and why, the display name).
 *
 * Deliberately NOT built on the shared `useFetch`: participation
 * commands hand back fresher state than any in-flight poll
 * ({@link UseConversationReturn.applyServerState}), which needs a write
 * fence over the fetch state — a seam `useFetch`'s single-writer model
 * does not have. The fence is an epoch counter: applying server state
 * bumps it, and a poll that started under an older epoch discards its
 * answer instead of resurrecting pre-command state under the user's
 * cursor.
 *
 * Pass empty strings to skip fetching (the `null`-fetchFn convention).
 */
export function useConversation(
  agentChannelId: string,
  conversationKey: string,
  options?: UseConversationOptions,
): UseConversationReturn {
  const stigmer = useStigmer();
  const refetchIntervalMs =
    options?.refetchIntervalMs ?? CONVERSATION_DETAIL_POLL_INTERVAL_MS;

  const enabled = agentChannelId !== "" && conversationKey !== "";

  const [conversation, setConversation] = useState<ChannelConversation | null>(null);
  const [awaitingCustomer, setAwaitingCustomer] = useState(false);
  const [hasAnswer, setHasAnswer] = useState(false);
  const [isFetching, setIsFetching] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  // The write fence: bumped by applyServerState and by identity changes;
  // a fetch that started under an older epoch throws its answer away.
  const epochRef = useRef(0);
  // Which fetch is the latest — ONLY the latest fetch's resolution may
  // clear the in-flight flags, so a fenced stale answer cannot strand
  // isFetching=true (which would silence the poll interval forever).
  const fetchIdRef = useRef(0);
  const isFetchingRef = useRef(false);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  const applyServerState = useCallback((fresh: ChannelConversation) => {
    epochRef.current += 1;
    setConversation(fresh);
    setAwaitingCustomer(false);
    setHasAnswer(true);
    setError(null);
  }, []);

  useEffect(() => {
    // Identity change (or disable): reset so channel A's control state
    // can never render under channel B's key.
    epochRef.current += 1;
    setConversation(null);
    setAwaitingCustomer(false);
    setHasAnswer(false);
    setError(null);
    if (!enabled) {
      setIsFetching(false);
      isFetchingRef.current = false;
    }
  }, [agentChannelId, conversationKey, stigmer, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const epoch = epochRef.current;
    const fetchId = ++fetchIdRef.current;
    setIsFetching(true);
    isFetchingRef.current = true;

    const settle = () => {
      if (fetchIdRef.current !== fetchId) return;
      setIsFetching(false);
      isFetchingRef.current = false;
    };

    stigmer.agentChannel
      .getConversation(
        create(GetChannelConversationInputSchema, { agentChannelId, conversationKey }),
      )
      .then(
        (row) => {
          if (epochRef.current === epoch) {
            // Preserve the reference across polls that change nothing —
            // a fresh-but-equal proto every 5s would defeat React.memo
            // on everything rendering the row (DD-010).
            setConversation((current) =>
              current && equals(ChannelConversationSchema, current, row)
                ? current
                : row,
            );
            setAwaitingCustomer(false);
            setHasAnswer(true);
            setError(null);
          }
          settle();
        },
        (err) => {
          if (epochRef.current === epoch) {
            if (isNotFound(err)) {
              // The legitimate "no row yet" answer — not an error state.
              setConversation(null);
              setAwaitingCustomer(true);
              setHasAnswer(true);
              setError(null);
            } else {
              setError(toError(err));
            }
          }
          settle();
        },
      );
  }, [enabled, agentChannelId, conversationKey, stigmer, fetchKey]);

  useEffect(() => {
    if (!enabled || !refetchIntervalMs || refetchIntervalMs <= 0) return;
    const id = setInterval(() => {
      if (!isFetchingRef.current) refetch();
    }, refetchIntervalMs);
    return () => clearInterval(id);
  }, [enabled, refetchIntervalMs, refetch]);

  const isLoading = isFetching && !hasAnswer;
  const isRefetching = isFetching && hasAnswer;

  return useMemo(
    () => ({
      conversation,
      awaitingCustomer,
      isLoading,
      isRefetching,
      error,
      refetch,
      applyServerState,
    }),
    [conversation, awaitingCustomer, isLoading, isRefetching, error, refetch, applyServerState],
  );
}

"use client";

import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useAgentChannel}. */
export interface UseAgentChannelReturn {
  /**
   * The channel, or `null` while loading, on error, or when no channel
   * with that ID exists (not-found is data, not an error).
   */
  readonly channel: AgentChannel | null;
  /** `true` while the initial fetch is in flight and no data is shown. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the channel from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that loads a single {@link AgentChannel} by ID.
 *
 * Not-found maps to `channel === null` rather than an error, so callers
 * can render an absent channel (e.g. deleted in another tab) without
 * error styling. Pass an empty `id` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { channel, isLoading, refetch } = useAgentChannel(channelId);
 * ```
 */
export function useAgentChannel(id: string): UseAgentChannelReturn {
  const stigmer = useStigmer();

  const fetchFn = id
    ? async () => {
        try {
          return await stigmer.agentChannel.get(id);
        } catch (err) {
          if (isNotFound(err)) return null;
          throw err;
        }
      }
    : null;

  const { data: channel, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [id, stigmer],
    null as AgentChannel | null,
  );

  return { channel, isLoading, isRefetching, error, refetch };
}

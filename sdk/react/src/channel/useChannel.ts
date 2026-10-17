"use client";

import type { Channel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { isNotFound } from "@stigmer/client";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useChannel}. */
export interface UseChannelReturn {
  /**
   * The channel, or `null` while loading, on error, or when no channel
   * with that ID exists (not-found is data, not an error).
   */
  readonly channel: Channel | null;
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
 * Data hook that loads a single {@link Channel} (any type) by ID.
 *
 * Not-found maps to `channel === null` rather than an error, so callers
 * can render an absent channel (e.g. deleted in another tab) without
 * error styling. Pass an empty `id` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { channel, isLoading, refetch } = useChannel(channelId);
 * ```
 */
export function useChannel(id: string): UseChannelReturn {
  const stigmer = useStigmer();

  const fetchFn = id
    ? async () => {
        try {
          return await stigmer.channel.get(id);
        } catch (err) {
          if (isNotFound(err)) return null;
          throw err;
        }
      }
    : null;

  const { data: channel, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [id, stigmer],
    null as Channel | null,
  );

  return { channel, isLoading, isRefetching, error, refetch };
}

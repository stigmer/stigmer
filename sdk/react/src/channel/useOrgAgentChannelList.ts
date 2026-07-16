"use client";

import { create } from "@bufbuild/protobuf";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { ListAgentChannelsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useOrgAgentChannelList}. */
export interface UseOrgAgentChannelListReturn {
  /**
   * The organization's channels visible to the caller, across all its
   * agents, in server order. Empty while loading, on error, or when the
   * org has none.
   */
  readonly channels: readonly AgentChannel[];
  /** `true` while the initial fetch is in flight and no data is shown. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the channels from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that loads an organization's {@link AgentChannel} resources
 * across all its agents — the org-wide view {@link useAgentChannelList}
 * (per-agent) cannot provide.
 *
 * The connect flow uses it to tell the user which workspaces a serving
 * app already occupies before they start the provider OAuth. The view is
 * permission-bounded (FGA-filtered in cloud), so treat it as advisory —
 * the database uniqueness index remains the arbiter.
 *
 * Pass `null` for `org` to skip fetching (stable no-op).
 */
export function useOrgAgentChannelList(
  org: string | null,
): UseOrgAgentChannelListReturn {
  const stigmer = useStigmer();

  const fetchFn = org
    ? async () => {
        const result = await stigmer.agentChannel.list(
          create(ListAgentChannelsRequestSchema, { org }),
        );
        return result.items;
      }
    : null;

  const { data: channels, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [org, stigmer],
    [] as AgentChannel[],
  );

  return { channels, isLoading, isRefetching, error, refetch };
}

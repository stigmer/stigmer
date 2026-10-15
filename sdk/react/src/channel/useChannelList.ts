"use client";

import { create } from "@bufbuild/protobuf";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { ListAgentChannelsByAgentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { LIST_PAGE_MAX, readEveryPage } from "../internal/everyPage.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useAgentChannelList}. */
export interface UseAgentChannelListReturn {
  /**
   * Every channel of the agent visible to the caller, in server order.
   * Empty while loading, on error, or when the agent has no channels —
   * `channels.length === 0 && !isLoading && !error` means "no channels
   * exist yet".
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
 * Data hook that loads an agent's {@link AgentChannel} resources — the
 * connections that expose the agent on external messaging platforms
 * (Slack in v1, more providers later).
 *
 * A channel serves traffic only when its provider install completed
 * (`status.installState === installed`) AND the owner's serving switch is
 * on (`spec.enabled`) — the two axes the Channels tab renders.
 *
 * Pass `org` to scope the list to one organization's channels; the server
 * only ever narrows the permission-bounded view. An agent has a handful of
 * channels and the tab shows them all, so the hook walks every page. Pass an empty `agentId`
 * to skip fetching (stable no-op) — useful while the agent is still
 * loading.
 *
 * @example
 * ```tsx
 * const { channels, isLoading, refetch } = useAgentChannelList(
 *   agent?.metadata?.id ?? "",
 *   viewerOrg,
 * );
 * ```
 */
export function useAgentChannelList(agentId: string, org?: string): UseAgentChannelListReturn {
  const stigmer = useStigmer();

  const fetchFn = agentId
    ? () =>
        readEveryPage((pageToken) =>
          stigmer.agentChannel.listByAgent(
            create(ListAgentChannelsByAgentRequestSchema, {
              agentId,
              org: org ?? "",
              pageSize: LIST_PAGE_MAX,
              pageToken,
            }),
          ),
        )
    : null;

  const { data: channels, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [agentId, org, stigmer],
    [] as AgentChannel[],
  );

  return { channels, isLoading, isRefetching, error, refetch };
}

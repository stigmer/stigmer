"use client";

import { create } from "@bufbuild/protobuf";
import type { Channel } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import { ListChannelsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { LIST_PAGE_MAX, readWholeList } from "../internal/everyPage.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useOrgChannelList}. */
export interface UseOrgChannelListReturn {
  /**
   * The organization's channels visible to the caller, across all its
   * agents, in server order. Empty while loading, on error, or when the
   * org has none.
   */
  readonly channels: readonly Channel[];
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
 * Data hook that loads an organization's {@link Channel} resources of
 * every type across all its agents — the org-wide view
 * {@link useChannelList} (per-agent) cannot provide. Callers filter by
 * `spec.type.case`.
 *
 * The connect flow uses it to tell the user which workspaces a serving
 * app already occupies before they start the provider OAuth. The view is
 * permission-bounded (FGA-filtered in cloud), so treat it as advisory —
 * the database uniqueness index remains the arbiter.
 *
 * The connect flow and the conversation filter need every channel, so the
 * hook walks every page of the list, with no cap: an organization may hold
 * more channels than a picker's cap.
 *
 * Pass `null` for `org` to skip fetching (stable no-op).
 */
export function useOrgChannelList(
  org: string | null,
): UseOrgChannelListReturn {
  const stigmer = useStigmer();

  const fetchFn = org
    ? () =>
        readWholeList((pageToken) =>
          stigmer.channel.list(
            create(ListChannelsRequestSchema, { org, pageSize: LIST_PAGE_MAX, pageToken }),
          ),
        )
    : null;

  const { data: channels, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [org, stigmer],
    [] as Channel[],
  );

  return { channels, isLoading, isRefetching, error, refetch };
}

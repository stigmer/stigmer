"use client";

import { create } from "@bufbuild/protobuf";
import type { Channel } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import { ListChannelsByAgentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { LIST_PAGE_MAX, readEveryPage } from "../internal/everyPage.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useChannelList}. */
export interface UseChannelListReturn {
  /**
   * Every channel of the agent visible to the caller, in server order.
   * Empty while loading, on error, or when the agent has no channels —
   * `channels.length === 0 && !isLoading && !error` means "no channels
   * exist yet".
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
 * Data hook that loads an agent's {@link Channel} resources of every type —
 * its chat links (`web`), its Slack workspaces and its WhatsApp numbers.
 * One list for the one kind: the Channels tab renders every type in it,
 * and a surface that needs one type filters it by `spec.type.case`.
 *
 * A Slack or WhatsApp channel serves traffic only when its provider install
 * completed (`status.installState === installed`) AND the owner's serving
 * switch is on (`spec.enabled`) — the two axes the Channels tab renders. A
 * web channel serves while `spec.enabled` is on.
 *
 * Pass `org` to scope the list to one organization's channels — the
 * agent's organization is the one a console tab asks for. The server
 * only ever narrows the permission-bounded view; omit `org` for the full
 * permission-bounded list. An agent has a handful of channels and the tabs
 * show them all, so the hook walks every page. Pass an empty `agentId` to
 * skip fetching (stable no-op) — useful while the agent is still loading.
 *
 * @example
 * ```tsx
 * const { channels, isLoading, refetch } = useChannelList(
 *   agent?.metadata?.id ?? "",
 *   viewerOrg,
 * );
 * const chatLinks = channels.filter((c) => c.spec?.type?.case === "web");
 * ```
 */
export function useChannelList(agentId: string, org?: string): UseChannelListReturn {
  const stigmer = useStigmer();

  const fetchFn = agentId
    ? () =>
        readEveryPage((pageToken) =>
          stigmer.channel.listByAgent(
            create(ListChannelsByAgentRequestSchema, {
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
    [] as Channel[],
  );

  return { channels, isLoading, isRefetching, error, refetch };
}

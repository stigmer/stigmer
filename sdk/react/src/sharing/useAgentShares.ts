"use client";

import { create } from "@bufbuild/protobuf";
import type { AgentShare } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { ListAgentSharesByAgentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { LIST_PAGE_MAX, readEveryPage } from "../internal/everyPage.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useAgentShares}. */
export interface UseAgentSharesReturn {
  /**
   * Every share of the agent visible to the caller, in server order.
   * Empty while loading, on error, or when the agent has never been
   * shared — `shares.length === 0 && !isLoading && !error` means "no
   * shares exist yet".
   */
  readonly shares: readonly AgentShare[];
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the shares from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that loads an agent's {@link AgentShare} resources — the
 * channels carrying its hosted-chat configuration (audience, allowed
 * origins, visitor messages, tool credentials, link token).
 *
 * Sharing is channel configuration, not agent behavior: an agent can carry N
 * shares, each with its own URL, audience and credentials, all in the agent's
 * own organization.
 *
 * Pass `org` to scope the list to one organization's channels — the
 * agent's organization is the one a console tab asks for. The server
 * applies the scope (it only ever narrows the permission-bounded view);
 * omit `org` for the full permission-bounded list, which for a member of
 * several organizations may also carry shares written before sharing
 * across organizations was retired.
 *
 * An agent has a handful of shares and the share dialog shows them all, so
 * the hook walks every page of the list.
 *
 * Pass an empty `agentId` to skip fetching (stable no-op) — useful
 * while the agent is still loading.
 *
 * @example
 * ```tsx
 * const { shares, isLoading, refetch } = useAgentShares(
 *   agent?.metadata?.id ?? "",
 *   viewerOrg,
 * );
 * ```
 */
export function useAgentShares(agentId: string, org?: string): UseAgentSharesReturn {
  const stigmer = useStigmer();

  const fetchFn = agentId
    ? () =>
        readEveryPage((pageToken) =>
          stigmer.agentShare.listByAgent(
            create(ListAgentSharesByAgentRequestSchema, {
              agentId,
              org: org ?? "",
              pageSize: LIST_PAGE_MAX,
              pageToken,
            }),
          ),
        )
    : null;

  const { data: shares, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [agentId, org, stigmer],
    [] as AgentShare[],
  );

  return { shares, isLoading, isRefetching, error, refetch };
}

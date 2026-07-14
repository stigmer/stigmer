"use client";

import { create } from "@bufbuild/protobuf";
import type { AgentShare } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { GetAgentSharesByAgentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/io_pb";
import { useStigmer } from "../hooks.js";
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
 * Data hook that loads all of an agent's {@link AgentShare} resources —
 * the channels carrying its hosted-chat configuration (audience, allowed
 * origins, visitor messages, tool credentials, link token).
 *
 * Sharing is channel configuration, not agent behavior (decision 011):
 * an agent can carry N shares, each with its own URL, billing org, and
 * credentials (decision 011 D3 + decision 013 cross-org shares). This
 * hook returns the full list; the server already scopes it to shares the
 * caller can view (FGA-filtered in cloud, unfiltered in the single-user
 * OSS edition), so a viewer sees their own org's channels and never
 * another org's.
 *
 * Pass an empty `agentId` to skip fetching (stable no-op) — useful
 * while the agent is still loading.
 *
 * @example
 * ```tsx
 * const { shares, isLoading, refetch } = useAgentShares(agent?.metadata?.id ?? "");
 * ```
 */
export function useAgentShares(agentId: string): UseAgentSharesReturn {
  const stigmer = useStigmer();

  const fetchFn = agentId
    ? async () => {
        const result = await stigmer.agentShare.getByAgent(
          create(GetAgentSharesByAgentRequestSchema, { agentId }),
        );
        return result.items;
      }
    : null;

  const { data: shares, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [agentId, stigmer],
    [] as AgentShare[],
  );

  return { shares, isLoading, isRefetching, error, refetch };
}

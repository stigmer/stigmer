"use client";

import { create } from "@bufbuild/protobuf";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentShare } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { GetAgentSharesByAgentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useAgentShare}. */
export interface UseAgentShareReturn {
  /**
   * The agent's canonical share, or `null` while loading, on error, or
   * when the agent has never been shared. `share === null && !isLoading
   * && !error` means "no share exists yet" — the first save creates it.
   */
  readonly share: AgentShare | null;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the share from the server. */
  readonly refetch: () => void;
}

/**
 * The canonical share among an agent's shares **within one sharing org**:
 * the one whose slug equals the agent's slug (the server's default when a
 * share is created without an explicit slug), falling back to the first
 * entry in that org. The data model allows N shares per agent across N
 * orgs (decision 011 D3 + decision 013), so the org filter is what keeps
 * each org's dialog on its own channel — without it, an owner who can
 * also see another org's share of the same agent would edit the wrong
 * one. Extra shares created via manifests never confuse the dialog.
 */
function pickCanonicalShare(
  shares: readonly AgentShare[],
  shareOrg: string,
  agentSlug: string,
): AgentShare | null {
  const inOrg = shares.filter((share) => share.metadata?.org === shareOrg);
  return (
    inOrg.find((share) => share.metadata?.slug === agentSlug) ??
    inOrg[0] ??
    null
  );
}

/**
 * Data hook that loads an agent's canonical {@link AgentShare} — the
 * resource carrying the hosted-chat channel configuration (audience,
 * allowed origins, visitor messages, tool credentials, link token).
 *
 * Sharing is channel configuration, not agent behavior (decision 011):
 * it lives in its own resource, so reading the agent alone can never
 * tell whether it is shared. This hook is how owner-side surfaces (the
 * Share dialog) resolve that state.
 *
 * `shareOrg` scopes resolution to one sharing org's channel and defaults
 * to the agent's own org (the owner's share). Pass the viewer's org to
 * manage a **cross-org share** — the viewer's own channel of another
 * org's marketplace-public agent (decision 013).
 *
 * Pass `null` for `agent` to skip fetching (stable no-op) — useful
 * while the agent is still loading. A resolved `null` share means the
 * agent has never been shared in `shareOrg`; the first save creates the
 * share.
 *
 * @example
 * ```tsx
 * const { share, isLoading } = useAgentShare(agent);
 *
 * if (isLoading) return <Spinner />;
 * const enabled = share?.spec?.enabled ?? false;
 * ```
 */
export function useAgentShare(
  agent: Agent | null,
  shareOrg?: string,
): UseAgentShareReturn {
  const stigmer = useStigmer();

  const agentId = agent?.metadata?.id ?? "";
  const agentSlug = agent?.metadata?.slug ?? "";
  const resolvedShareOrg = shareOrg || (agent?.metadata?.org ?? "");

  const fetchFn = agentId
    ? async () => {
        const result = await stigmer.agentShare.getByAgent(
          create(GetAgentSharesByAgentRequestSchema, { agentId }),
        );
        return pickCanonicalShare(result.items, resolvedShareOrg, agentSlug);
      }
    : null;

  const { data: share, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [agentId, agentSlug, resolvedShareOrg, stigmer],
    null as AgentShare | null,
  );

  return { share, isLoading, isRefetching, error, refetch };
}

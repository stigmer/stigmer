"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAgentQueryService } from "@stigmer/agent";
import { SYSTEM_AGENT_ORG } from "@/config/draft";
import { agentKeys } from "./keys";

/**
 * Resolves a system agent blueprint by slug from the "stigmer" organization.
 *
 * System agents (skill-creator, agent-creator, mcp-server-creator) are owned
 * by the platform org. This hook is independent of the user's active org —
 * it always resolves from {@link SYSTEM_AGENT_ORG}.
 */
export function useDraftAgent(slug: string) {
  const service = useAgentQueryService();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: agentKeys.reference(SYSTEM_AGENT_ORG, slug),
    queryFn: () => service.getByReference(SYSTEM_AGENT_ORG, slug),
    enabled: !!slug,
  });

  const retry = useCallback(() => {
    refetch();
  }, [refetch]);

  return {
    agent: data ?? null,
    isResolving: isLoading,
    error: error
      ? (error as Error).message || `Failed to resolve system agent "${slug}"`
      : null,
    retry,
  };
}

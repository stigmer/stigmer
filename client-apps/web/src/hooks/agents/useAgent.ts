"use client";

import { useQuery } from "@tanstack/react-query";
import { useStigmer } from "@stigmer/react";
import { agentKeys } from "./keys";

/**
 * Fetches a full Agent resource by ID.
 *
 * Returns the complete agent including metadata, spec (instructions,
 * MCP server usages, skill refs, sub-agents), and status.
 *
 * The query is disabled when `agentId` is falsy, allowing conditional
 * fetching (e.g. before an ID is available from route params).
 */
export function useAgent(agentId: string) {
  const stigmer = useStigmer();

  return useQuery({
    queryKey: agentKeys.detail(agentId),
    queryFn: () => stigmer.agent.get(agentId),
    enabled: !!agentId,
  });
}

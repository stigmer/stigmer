"use client";

import { useQuery } from "@tanstack/react-query";
import { useStigmer } from "@stigmer/react";
import { useActiveOrgSlug } from "@/contexts/org-context";
import { dashboardKeys } from "./keys";

export interface ResourceCount {
  count: number;
  isLoading: boolean;
  error: Error | null;
}

export interface DashboardCounts {
  agents: ResourceCount;
  skills: ResourceCount;
  mcpServers: ResourceCount;
}

const COUNT_QUERY_PAGE = { num: 1, size: 1 };

/**
 * Fetches resource counts for the active organization's dashboard.
 *
 * Fires 3 parallel search queries (agents, skills, MCP servers) with
 * `page: { size: 1 }` to minimize payload — we only need `totalCount`
 * from each `SearchResponse`. Each query is independent: if one fails,
 * the others still display.
 */
export function useDashboardCounts(): DashboardCounts {
  const org = useActiveOrgSlug();
  const stigmer = useStigmer();

  const agents = useQuery({
    queryKey: [...dashboardKeys.counts(org), "agents"],
    queryFn: () =>
      stigmer.agent.list({ org, query: "", page: COUNT_QUERY_PAGE }),
    enabled: !!org,
    select: (data) => data.totalCount,
  });

  const skills = useQuery({
    queryKey: [...dashboardKeys.counts(org), "skills"],
    queryFn: () =>
      stigmer.skill.list({ org, query: "", page: COUNT_QUERY_PAGE }),
    enabled: !!org,
    select: (data) => data.totalCount,
  });

  const mcpServers = useQuery({
    queryKey: [...dashboardKeys.counts(org), "mcp-servers"],
    queryFn: () =>
      stigmer.mcpServer.list({ org, query: "", page: COUNT_QUERY_PAGE }),
    enabled: !!org,
    select: (data) => data.totalCount,
  });

  return {
    agents: {
      count: agents.data ?? 0,
      isLoading: agents.isLoading,
      error: agents.error as Error | null,
    },
    skills: {
      count: skills.data ?? 0,
      isLoading: skills.isLoading,
      error: skills.error as Error | null,
    },
    mcpServers: {
      count: mcpServers.data ?? 0,
      isLoading: mcpServers.isLoading,
      error: mcpServers.error as Error | null,
    },
  };
}

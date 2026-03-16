"use client";

import { useQuery } from "@tanstack/react-query";
import { useStigmer } from "@stigmer/react";
import { mcpServerKeys } from "./keys";

/**
 * Fetches a full McpServer resource by ID.
 *
 * Returns the complete MCP server including metadata, spec (server type,
 * tool approvals, env spec), and status (validation, discovered capabilities).
 */
export function useMcpServer(mcpServerId: string) {
  const stigmer = useStigmer();

  return useQuery({
    queryKey: mcpServerKeys.detail(mcpServerId),
    queryFn: () => stigmer.mcpServer.get(mcpServerId),
    enabled: !!mcpServerId,
  });
}

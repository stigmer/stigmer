"use client";

import { useQuery } from "@tanstack/react-query";
import { useMcpServerQueryService } from "@stigmer/mcp-server-ui";
import { mcpServerKeys } from "./keys";

/**
 * Fetches a full McpServer resource by ID.
 *
 * Returns the complete MCP server including metadata, spec (server type,
 * tool approvals, env spec), and status (validation, discovered capabilities).
 */
export function useMcpServer(mcpServerId: string) {
  const service = useMcpServerQueryService();

  return useQuery({
    queryKey: mcpServerKeys.detail(mcpServerId),
    queryFn: () => service.get(mcpServerId),
    enabled: !!mcpServerId,
  });
}

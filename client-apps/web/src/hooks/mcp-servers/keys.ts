/**
 * Query key factory for the MCP Server domain.
 */
export const mcpServerKeys = {
  all: ["mcp-servers"] as const,
  lists: () => [...mcpServerKeys.all, "list"] as const,
  list: (filters: Record<string, unknown>) =>
    [...mcpServerKeys.lists(), filters] as const,
  details: () => [...mcpServerKeys.all, "detail"] as const,
  detail: (id: string) => [...mcpServerKeys.details(), id] as const,
};

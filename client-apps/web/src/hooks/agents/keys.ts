/**
 * Query key factory for the Agent domain.
 *
 * Hierarchical keys enable precise cache invalidation:
 *   - `agentKeys.all`        — invalidates everything agent-related
 *   - `agentKeys.lists()`    — invalidates all list/search queries
 *   - `agentKeys.list(opts)` — invalidates one specific list query
 *   - `agentKeys.details()`  — invalidates all detail queries
 *   - `agentKeys.detail(id)` — invalidates one specific agent
 */
export const agentKeys = {
  all: ["agents"] as const,
  lists: () => [...agentKeys.all, "list"] as const,
  list: (filters: Record<string, unknown>) =>
    [...agentKeys.lists(), filters] as const,
  details: () => [...agentKeys.all, "detail"] as const,
  detail: (id: string) => [...agentKeys.details(), id] as const,
  search: (query: string, org: string) =>
    [...agentKeys.all, "search", { query, org }] as const,
  reference: (org: string, slug: string) =>
    [...agentKeys.all, "reference", { org, slug }] as const,
};

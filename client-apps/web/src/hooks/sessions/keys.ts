/**
 * Query key factory for the Session domain.
 *
 * Hierarchical keys enable precise cache invalidation:
 *   - `sessionKeys.all`                — invalidates everything session-related
 *   - `sessionKeys.lists()`            — invalidates all list queries
 *   - `sessionKeys.list(opts)`         — invalidates one specific list query
 *   - `sessionKeys.byAgent(agentId)`   — invalidates sessions for a specific agent
 *   - `sessionKeys.details()`          — invalidates all detail queries
 *   - `sessionKeys.detail(id)`         — invalidates one specific session
 *   - `sessionKeys.executions(id)`     — invalidates executions for a session
 */
export const sessionKeys = {
  all: ["sessions"] as const,
  lists: () => [...sessionKeys.all, "list"] as const,
  list: (filters: Record<string, unknown>) =>
    [...sessionKeys.lists(), filters] as const,
  byAgent: (agentId: string, filters: Record<string, unknown>) =>
    [...sessionKeys.all, "by-agent", agentId, filters] as const,
  details: () => [...sessionKeys.all, "detail"] as const,
  detail: (id: string) => [...sessionKeys.details(), id] as const,
  executions: (sessionId: string) =>
    [...sessionKeys.all, "executions", sessionId] as const,
};

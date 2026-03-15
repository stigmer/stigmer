/**
 * Query key factory for the Skill domain.
 */
export const skillKeys = {
  all: ["skills"] as const,
  lists: () => [...skillKeys.all, "list"] as const,
  list: (filters: Record<string, unknown>) =>
    [...skillKeys.lists(), filters] as const,
  details: () => [...skillKeys.all, "detail"] as const,
  detail: (id: string) => [...skillKeys.details(), id] as const,
};

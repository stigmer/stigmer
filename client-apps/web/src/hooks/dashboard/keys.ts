/**
 * Query key factory for the Dashboard domain.
 *
 * Hierarchical keys enable precise cache invalidation:
 *   - `dashboardKeys.all`          — invalidates everything dashboard-related
 *   - `dashboardKeys.counts(org)`  — invalidates resource counts for an org
 */
export const dashboardKeys = {
  all: ["dashboard"] as const,
  counts: (org: string) => [...dashboardKeys.all, "counts", org] as const,
};

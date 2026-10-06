"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import { useDashboardSummary, type UseDashboardSummaryOptions } from "./useDashboardSummary.js";
import { useDashboardFailedRuns } from "./useDashboardFailedRuns.js";
import { DashboardKPICards } from "./DashboardKPICards.js";
import { DashboardFailedRuns } from "./DashboardFailedRuns.js";

export interface OperationalDashboardProps {
  /** The organization whose runs and usage the dashboard shows. */
  readonly org: string | null | undefined;
  /** Called with the agent run's ID when the user clicks "View" on a failed run. */
  readonly onFailedRunClick?: (id: string) => void;
  readonly className?: string;
}

/**
 * Composed dashboard widget showing an organization's agent run
 * operational metrics.
 *
 * Layout:
 * - Row 1: KPI stat cards (Active | Completed | Failed | Total Cost)
 * - Row 2: Recent Failures
 *
 * Cost comes from the billing source of truth (`getOrgUsageReport`),
 * not from summing per-run costs, so the dashboard shows what billing
 * recorded.
 *
 * @example
 * ```tsx
 * <OperationalDashboard
 *   org="acme"
 *   onFailedRunClick={(id) => navigate(`/runs/${id}`)}
 * />
 * ```
 */
export const OperationalDashboard = memo(function OperationalDashboard({
  org,
  onFailedRunClick,
  className,
}: OperationalDashboardProps) {
  const summaryOptions: UseDashboardSummaryOptions = {
    org,
    refetchInterval: 60_000,
  };
  const { summary, isLoading: summaryLoading } = useDashboardSummary(summaryOptions);

  const { failedRuns, isLoading: failedLoading } = useDashboardFailedRuns(org);

  return (
    <section
      aria-label="Platform dashboard"
      className={cn("stg:space-y-6", className)}
    >
      <DashboardKPICards summary={summary} isLoading={summaryLoading} />

      <DashboardFailedRuns
        failedRuns={failedRuns}
        isLoading={failedLoading}
        onViewClick={onFailedRunClick}
      />
    </section>
  );
});

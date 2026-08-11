"use client";

import { memo, useCallback } from "react";
import { cn } from "@stigmer/theme";
import { usePendingApprovals } from "../workflow/usePendingApprovals.js";
import { PendingApprovalsWidget } from "../workflow/PendingApprovalsWidget.js";
import { useDashboardSummary, type UseDashboardSummaryOptions } from "./useDashboardSummary.js";
import { useDashboardFailedRuns } from "./useDashboardFailedRuns.js";
import { DashboardKPICards } from "./DashboardKPICards.js";
import { DashboardFailedRuns } from "./DashboardFailedRuns.js";
import type { DashboardFailedRun } from "./types.js";

export interface OperationalDashboardProps {
  /** Organization slug for execution summaries and pending approvals. */
  readonly org: string | null | undefined;
  /** Organization ID (metadata.id) for the usage report. */
  readonly orgId: string | null | undefined;
  /** Called when the user clicks "Review" on a pending approval. */
  readonly onApprovalClick?: (executionId: string) => void;
  /** Called when the user clicks "View" on a failed execution. */
  readonly onFailedRunClick?: (id: string, type: DashboardFailedRun["type"]) => void;
  readonly className?: string;
}

/**
 * Composed dashboard widget that aggregates operational metrics from both
 * agent and workflow domains into a unified platform view.
 *
 * Layout:
 * - Row 1: KPI stat cards (Active | Completed | Failed | Total Cost)
 * - Row 2: Pending Approvals | Recent Failures (2-column grid)
 *
 * Cost comes from the billing source of truth (`getOrgUsageReport`),
 * not from summing agent + workflow costs. See AD-DASH-005.
 *
 * @example
 * ```tsx
 * <OperationalDashboard
 *   org="acme"
 *   orgId={activeOrg?.metadata?.id}
 *   onApprovalClick={(id) => navigate(`/executions/${id}`)}
 *   onFailedRunClick={(id, type) => navigate(`/executions/${id}`)}
 * />
 * ```
 *
 * @since Unified Platform Dashboard
 */
export const OperationalDashboard = memo(function OperationalDashboard({
  org,
  orgId,
  onApprovalClick,
  onFailedRunClick,
  className,
}: OperationalDashboardProps) {
  const summaryOptions: UseDashboardSummaryOptions = {
    org,
    orgId,
    refetchInterval: 60_000,
  };
  const { summary, isLoading: summaryLoading } = useDashboardSummary(summaryOptions);

  const { approvals, totalCount: approvalCount, isLoading: approvalsLoading } =
    usePendingApprovals({ org, refetchInterval: 30_000 });

  const { failedRuns, isLoading: failedLoading } = useDashboardFailedRuns(org);

  const handleFailedRunClick = useCallback(
    (id: string, type: DashboardFailedRun["type"]) => {
      onFailedRunClick?.(id, type);
    },
    [onFailedRunClick],
  );

  return (
    <section
      aria-label="Platform dashboard"
      className={cn("stg:space-y-6", className)}
    >
      <DashboardKPICards summary={summary} isLoading={summaryLoading} />

      <div className="stg:grid stg:gap-6 stg:lg:grid-cols-2">
        <PendingApprovalsWidget
          approvals={approvals}
          totalCount={approvalCount}
          isLoading={approvalsLoading}
          onReviewClick={onApprovalClick}
        />
        <DashboardFailedRuns
          failedRuns={failedRuns}
          isLoading={failedLoading}
          onViewClick={handleFailedRunClick}
        />
      </div>
    </section>
  );
});

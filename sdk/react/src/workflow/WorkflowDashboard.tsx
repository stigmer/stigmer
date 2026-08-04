"use client";

import { memo, useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { ListWorkflowExecutionsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { cn } from "@stigmer/theme";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import {
  useWorkflowDashboardSummary,
  type UseWorkflowDashboardSummaryOptions,
} from "./useWorkflowDashboardSummary.js";
import { usePendingApprovals } from "./usePendingApprovals.js";
import { ExecutionSummaryWidget } from "./ExecutionSummaryWidget.js";
import { PendingApprovalsWidget } from "./PendingApprovalsWidget.js";
import { FailedRunsWidget } from "./FailedRunsWidget.js";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";

export interface WorkflowDashboardProps {
  /** Organization slug for scoping the dashboard data. */
  readonly org: string | null | undefined;
  /** Time window for the summary statistics. */
  readonly timeWindow?: UseWorkflowDashboardSummaryOptions["timeWindow"];
  /** Called when the user clicks "Review" on a pending approval. */
  readonly onApprovalClick?: (executionId: string) => void;
  /** Called when the user clicks "View" on a failed execution. */
  readonly onFailedRunClick?: (executionId: string) => void;
  readonly className?: string;
}

const FAILED_LIST_INITIAL: readonly WorkflowExecution[] = [];

/**
 * Composed dashboard widget that aggregates execution KPIs,
 * pending approvals, and recent failures into a responsive layout.
 *
 * Composes three sub-widgets:
 * - **ExecutionSummaryWidget** — phase counts, cost, duration
 * - **PendingApprovalsWidget** — human_input tasks awaiting decisions
 * - **FailedRunsWidget** — recent failed executions (from existing list API)
 *
 * All data fetching is internal. The consumer provides org context and
 * navigation callbacks.
 *
 * @example
 * ```tsx
 * <WorkflowDashboard
 *   org="acme"
 *   onApprovalClick={(id) => navigate(`/workflows/executions/${id}`)}
 *   onFailedRunClick={(id) => navigate(`/workflows/executions/${id}`)}
 * />
 * ```
 */
export const WorkflowDashboard = memo(function WorkflowDashboard({
  org,
  timeWindow,
  onApprovalClick,
  onFailedRunClick,
  className,
}: WorkflowDashboardProps) {
  const stigmer = useStigmer();

  const { summary, isLoading: summaryLoading } =
    useWorkflowDashboardSummary({
      org,
      timeWindow,
      refetchInterval: 60_000,
    });

  const {
    approvals,
    totalCount: approvalCount,
    isLoading: approvalsLoading,
  } = usePendingApprovals({ org, refetchInterval: 30_000 });

  const fetchFailedFn = useMemo(
    () =>
      org
        ? async () => {
            const resp = await stigmer.workflowExecution.list(
              create(ListWorkflowExecutionsRequestSchema, {
                pageSize: 5,
                phase: ExecutionPhase.EXECUTION_FAILED,
                org,
              }),
            );
            return [...resp.entries] as readonly WorkflowExecution[];
          }
        : null,
    [stigmer, org],
  );

  const { data: failedRuns, isLoading: failedLoading } = useFetch<
    readonly WorkflowExecution[]
  >(fetchFailedFn, [stigmer, org], FAILED_LIST_INITIAL, {
    refetchInterval: 60_000,
  });

  return (
    <section
      aria-label="Workflow dashboard"
      className={cn("space-y-6", className)}
    >
      <ExecutionSummaryWidget
        summary={summary}
        isLoading={summaryLoading}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <PendingApprovalsWidget
          approvals={approvals}
          totalCount={approvalCount}
          isLoading={approvalsLoading}
          onReviewClick={onApprovalClick}
        />
        <FailedRunsWidget
          executions={failedRuns}
          isLoading={failedLoading}
          onViewClick={onFailedRunClick}
        />
      </div>
    </section>
  );
});

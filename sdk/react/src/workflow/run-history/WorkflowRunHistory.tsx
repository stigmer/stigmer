"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { useWorkflowDashboardSummary } from "../useWorkflowDashboardSummary.js";
import { useWorkflowRunList } from "../useWorkflowRunList.js";
import { deriveRunRows, filterRunRows, type RunClientFilters } from "./derive-run-row.js";
import { RunHistoryTable } from "./RunHistoryTable.js";
import { RunFilterBar } from "./RunFilterBar.js";
import { HealthMetricsStrip } from "./HealthMetricsStrip.js";
import { FailureAnalysisPanel } from "./FailureAnalysisPanel.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Props for {@link WorkflowRunHistory}. */
export interface WorkflowRunHistoryProps {
  /** Organization id for scoping dashboard summary data (a slug is also accepted). */
  readonly org: string;
  /**
   * When set, scopes to a single workflow's runs.
   * When omitted, shows all runs across all workflows.
   */
  readonly workflowId?: string;
  /** Called when the user clicks a run row. */
  readonly onRunClick?: (executionId: string) => void;
  /** Maximum runs per page. @default 20 */
  readonly pageSize?: number;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Composed run history view assembling health metrics, a filter
 * bar, a sortable data table, and a failure analysis panel.
 *
 * Self-contained: fetches data internally via `useWorkflowRunList`
 * and `useWorkflowDashboardSummary`. Zero Console dependencies.
 *
 * Layout:
 * ```
 * HealthMetricsStrip
 * RunFilterBar
 * RunHistoryTable
 * FailureAnalysisPanel (collapsible)
 * ```
 *
 * @example
 * ```tsx
 * <WorkflowRunHistory
 *   org="acme"
 *   workflowId={workflow.metadata?.id}
 *   onRunClick={(id) => navigate(`/runs/${id}`)}
 * />
 * ```
 */
export const WorkflowRunHistory = memo(function WorkflowRunHistory({
  org,
  workflowId,
  onRunClick,
  pageSize = 20,
  className,
}: WorkflowRunHistoryProps) {
  const [clientFilters, setClientFilters] = useState<RunClientFilters>({});

  const { summary, isLoading: summaryLoading } = useWorkflowDashboardSummary({
    org,
    workflowId,
    refetchInterval: 60_000,
  });

  const {
    runs: executions,
    isLoading: listLoading,
    error: listError,
  } = useWorkflowRunList({ workflowId, pageSize });

  const allRows = useMemo(
    () => deriveRunRows(executions),
    [executions],
  );

  const filteredRows = useMemo(() => {
    if (Object.keys(clientFilters).length === 0) return allRows;
    return filterRunRows(allRows, clientFilters);
  }, [allRows, clientFilters]);

  const handleFiltersChange = useCallback((next: RunClientFilters) => {
    setClientFilters(next);
  }, []);

  return (
    <section
      aria-label="Run history"
      className={cn("stg:flex stg:flex-col stg:gap-4", className)}
    >
      <HealthMetricsStrip summary={summary} isLoading={summaryLoading} />

      <RunFilterBar
        filters={clientFilters}
        onFiltersChange={handleFiltersChange}
      />

      <RunHistoryTable
        rows={filteredRows}
        isLoading={listLoading}
        error={listError}
        onRowClick={onRunClick}
      />

      <FailureAnalysisPanel
        runs={executions}
        onRunClick={onRunClick}
      />
    </section>
  );
});

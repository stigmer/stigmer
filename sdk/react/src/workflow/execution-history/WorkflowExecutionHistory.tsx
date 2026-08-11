"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { useWorkflowDashboardSummary } from "../useWorkflowDashboardSummary.js";
import { useWorkflowExecutionList } from "../useWorkflowExecutionList.js";
import { deriveExecutionRows, filterExecutionRows, type ExecutionClientFilters } from "./derive-execution-row.js";
import { ExecutionHistoryTable } from "./ExecutionHistoryTable.js";
import { ExecutionFilterBar } from "./ExecutionFilterBar.js";
import { HealthMetricsStrip } from "./HealthMetricsStrip.js";
import { FailureAnalysisPanel } from "./FailureAnalysisPanel.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Props for {@link WorkflowExecutionHistory}. */
export interface WorkflowExecutionHistoryProps {
  /** Organization slug for scoping dashboard summary data. */
  readonly org: string;
  /**
   * When set, scopes to a single workflow's executions.
   * When omitted, shows all executions across all workflows.
   */
  readonly workflowId?: string;
  /** Called when the user clicks an execution row. */
  readonly onExecutionClick?: (executionId: string) => void;
  /** Maximum executions per page. @default 20 */
  readonly pageSize?: number;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Composed execution history view assembling health metrics, a filter
 * bar, a sortable data table, and a failure analysis panel.
 *
 * Self-contained: fetches data internally via `useWorkflowExecutionList`
 * and `useWorkflowDashboardSummary`. Zero Console dependencies.
 *
 * Layout:
 * ```
 * HealthMetricsStrip
 * ExecutionFilterBar
 * ExecutionHistoryTable
 * FailureAnalysisPanel (collapsible)
 * ```
 *
 * @example
 * ```tsx
 * <WorkflowExecutionHistory
 *   org="acme"
 *   workflowId={workflow.metadata?.id}
 *   onExecutionClick={(id) => navigate(`/executions/${id}`)}
 * />
 * ```
 */
export const WorkflowExecutionHistory = memo(function WorkflowExecutionHistory({
  org,
  workflowId,
  onExecutionClick,
  pageSize = 20,
  className,
}: WorkflowExecutionHistoryProps) {
  const [clientFilters, setClientFilters] = useState<ExecutionClientFilters>({});

  const { summary, isLoading: summaryLoading } = useWorkflowDashboardSummary({
    org,
    workflowId,
    refetchInterval: 60_000,
  });

  const {
    executions,
    isLoading: listLoading,
    error: listError,
  } = useWorkflowExecutionList({ workflowId, pageSize });

  const allRows = useMemo(
    () => deriveExecutionRows(executions),
    [executions],
  );

  const filteredRows = useMemo(() => {
    if (Object.keys(clientFilters).length === 0) return allRows;
    return filterExecutionRows(allRows, clientFilters);
  }, [allRows, clientFilters]);

  const handleFiltersChange = useCallback((next: ExecutionClientFilters) => {
    setClientFilters(next);
  }, []);

  return (
    <section
      aria-label="Execution history"
      className={cn("stg:flex stg:flex-col stg:gap-4", className)}
    >
      <HealthMetricsStrip summary={summary} isLoading={summaryLoading} />

      <ExecutionFilterBar
        filters={clientFilters}
        onFiltersChange={handleFiltersChange}
      />

      <ExecutionHistoryTable
        rows={filteredRows}
        isLoading={listLoading}
        error={listError}
        onRowClick={onExecutionClick}
      />

      <FailureAnalysisPanel
        executions={executions}
        onExecutionClick={onExecutionClick}
      />
    </section>
  );
});

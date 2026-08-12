"use client";

import { memo, useMemo, useState, useCallback } from "react";
import { cn } from "@stigmer/theme";
import { WorkflowTaskStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { formatDuration, formatMicroUsd } from "../format-utils.js";
import type { TaskComparison, ExecutionComparison } from "./types.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../internal/tooltip.js";

/** Props for {@link TaskComparisonTable}. */
export interface TaskComparisonTableProps {
  readonly comparison: ExecutionComparison;
  /** When `true`, only shows tasks with differences. @default false */
  readonly changesOnly?: boolean;
  readonly className?: string;
}

type FilterMode = "all" | "changed" | "failed";

const BIGINT_ZERO = BigInt(0);

/**
 * Per-task comparison table showing status, duration, and cost
 * differences between two executions.
 *
 * Tasks are ordered by execution position. Changed tasks are
 * highlighted with a subtle background. The divergence point
 * (first difference) is visually marked.
 */
export const TaskComparisonTable = memo(function TaskComparisonTable({
  comparison,
  changesOnly = false,
  className,
}: TaskComparisonTableProps) {
  const [filter, setFilter] = useState<FilterMode>(changesOnly ? "changed" : "all");

  const filtered = useMemo(() => {
    switch (filter) {
      case "changed":
        return comparison.tasks.filter((t) => t.statusChanged);
      case "failed":
        return comparison.tasks.filter(
          (t) =>
            t.baseStatus === WorkflowTaskStatus.WORKFLOW_TASK_FAILED ||
            t.compareStatus === WorkflowTaskStatus.WORKFLOW_TASK_FAILED,
        );
      default:
        return comparison.tasks;
    }
  }, [comparison.tasks, filter]);

  const handleFilterChange = useCallback((mode: FilterMode) => setFilter(mode), []);

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-2", className)}>
      {/* Filter controls */}
      <div className="stg:flex stg:items-center stg:gap-1" role="tablist" aria-label="Task filter">
        <FilterChip
          label="All"
          count={comparison.tasks.length}
          active={filter === "all"}
          onClick={() => handleFilterChange("all")}
        />
        <FilterChip
          label="Changed"
          count={comparison.tasks.filter((t) => t.statusChanged).length}
          active={filter === "changed"}
          onClick={() => handleFilterChange("changed")}
        />
        <FilterChip
          label="Failed"
          count={comparison.tasks.filter(
            (t) =>
              t.baseStatus === WorkflowTaskStatus.WORKFLOW_TASK_FAILED ||
              t.compareStatus === WorkflowTaskStatus.WORKFLOW_TASK_FAILED,
          ).length}
          active={filter === "failed"}
          onClick={() => handleFilterChange("failed")}
        />
      </div>

      {/* Table */}
      <div className="stg:overflow-x-auto stg:rounded-md stg:border stg:border-[var(--stgm-border,#e5e5e5)]">
        <table className="stg:w-full stg:text-xs" aria-label="Task comparison">
          <thead>
            <tr className="stg:border-b stg:border-[var(--stgm-border,#e5e5e5)] stg:bg-[var(--stgm-muted,#f5f5f5)]">
              <th className="stg:px-3 stg:py-2 stg:text-left stg:font-medium stg:text-[var(--stgm-muted-foreground,#737373)]">
                Task
              </th>
              <th className="stg:px-3 stg:py-2 stg:text-center stg:font-medium stg:text-[var(--stgm-muted-foreground,#737373)]">
                Base Status
              </th>
              <th className="stg:px-3 stg:py-2 stg:text-center stg:font-medium stg:text-[var(--stgm-muted-foreground,#737373)]">
                Compare Status
              </th>
              <th className="stg:px-3 stg:py-2 stg:text-right stg:font-medium stg:text-[var(--stgm-muted-foreground,#737373)]">
                Duration
              </th>
              <th className="stg:px-3 stg:py-2 stg:text-right stg:font-medium stg:text-[var(--stgm-muted-foreground,#737373)]">
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="stg:px-3 stg:py-6 stg:text-center stg:text-[var(--stgm-muted-foreground,#737373)]">
                  {filter === "all" ? "No tasks to compare." : "No matching tasks."}
                </td>
              </tr>
            )}
            {filtered.map((task) => (
              <TaskRow
                key={task.taskName}
                task={task}
                isDivergencePoint={task.taskName === comparison.divergencePoint}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Unmatched tasks */}
      {(comparison.tasksOnlyInBase.length > 0 || comparison.tasksOnlyInCompare.length > 0) && (
        <div className="stg:mt-1 stg:text-[10px] stg:text-[var(--stgm-muted-foreground,#737373)]">
          {comparison.tasksOnlyInBase.length > 0 && (
            <p>Only in base: {comparison.tasksOnlyInBase.join(", ")}</p>
          )}
          {comparison.tasksOnlyInCompare.length > 0 && (
            <p>Only in compare: {comparison.tasksOnlyInCompare.join(", ")}</p>
          )}
        </div>
      )}
    </div>
  );
});

const TaskRow = memo(function TaskRow({
  task,
  isDivergencePoint,
}: {
  task: TaskComparison;
  isDivergencePoint: boolean;
}) {
  return (
    <tr
      className={cn(
        "stg:border-b stg:border-[var(--stgm-border,#e5e5e5)] stg:last:border-b-0",
        task.statusChanged && "stg:bg-[var(--stgm-destructive,#dc2626)]/5",
        isDivergencePoint && "stg:ring-1 stg:ring-inset stg:ring-[var(--stgm-warning,#f59e0b)]/50",
      )}
    >
      <td className="stg:px-3 stg:py-2">
        <div className="stg:flex stg:items-center stg:gap-1.5">
          {isDivergencePoint && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className="stg:inline-block stg:h-1.5 stg:w-1.5 stg:rounded-full stg:bg-[var(--stgm-warning,#f59e0b)]"
                    aria-label="Divergence point"
                  />
                }
              />
              <TooltipContent side="top">First point of divergence</TooltipContent>
            </Tooltip>
          )}
          <span className="stg:font-medium stg:text-[var(--stgm-foreground,#1a1a2e)]">
            {task.taskName}
          </span>
        </div>
      </td>
      <td className="stg:px-3 stg:py-2 stg:text-center">
        <TaskStatusBadge status={task.baseStatus} />
      </td>
      <td className="stg:px-3 stg:py-2 stg:text-center">
        <TaskStatusBadge status={task.compareStatus} />
      </td>
      <td className="stg:px-3 stg:py-2 stg:text-right">
        <DurationCell task={task} />
      </td>
      <td className="stg:px-3 stg:py-2 stg:text-right">
        <CostCell task={task} />
      </td>
    </tr>
  );
});

function TaskStatusBadge({ status }: { status: WorkflowTaskStatus }) {
  const config = TASK_STATUS_CONFIG.get(status) ?? { label: "Unknown", colorClass: "stg:text-[var(--stgm-muted-foreground,#737373)]" };
  return (
    <span className={cn("stg:inline-flex stg:items-center stg:gap-1 stg:text-[10px] stg:font-medium", config.colorClass)}>
      {config.label}
    </span>
  );
}

function DurationCell({ task }: { task: TaskComparison }) {
  if (task.baseDurationMs == null && task.compareDurationMs == null) return <span>—</span>;

  const baseStr = task.baseDurationMs != null ? formatDuration(task.baseDurationMs) : "—";
  const compareStr = task.compareDurationMs != null ? formatDuration(task.compareDurationMs) : "—";

  if (task.durationDeltaMs == null || task.durationDeltaMs === 0) {
    return <span className="stg:text-[var(--stgm-muted-foreground,#737373)]">{baseStr}</span>;
  }

  const sign = task.durationDeltaMs > 0 ? "+" : "−";
  const abs = Math.abs(task.durationDeltaMs);
  const deltaColor = task.durationDeltaMs > 0
    ? "stg:text-[var(--stgm-destructive,#dc2626)]"
    : "stg:text-[var(--stgm-success,#16a34a)]";

  return (
    <span className="stg:flex stg:flex-col stg:items-end">
      <span className="stg:text-[var(--stgm-foreground,#1a1a2e)]">{baseStr} / {compareStr}</span>
      <span className={cn("stg:text-[10px]", deltaColor)}>
        {sign}{formatDuration(abs)}
      </span>
    </span>
  );
}

function CostCell({ task }: { task: TaskComparison }) {
  if (task.baseCostMicros === BIGINT_ZERO && task.compareCostMicros === BIGINT_ZERO) {
    return <span className="stg:text-[var(--stgm-muted-foreground,#737373)]">—</span>;
  }

  const baseStr = task.baseCostMicros > BIGINT_ZERO ? formatMicroUsd(task.baseCostMicros) : "—";
  const compareStr = task.compareCostMicros > BIGINT_ZERO ? formatMicroUsd(task.compareCostMicros) : "—";
  const delta = task.baseCostMicros - task.compareCostMicros;

  if (delta === BIGINT_ZERO) {
    return <span className="stg:text-[var(--stgm-muted-foreground,#737373)]">{baseStr}</span>;
  }

  return (
    <span className="stg:text-[var(--stgm-foreground,#1a1a2e)]">{baseStr} / {compareStr}</span>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "stg:rounded-full stg:px-2.5 stg:py-1 stg:text-[10px] stg:font-medium stg:transition-colors",
        active
          ? "stg:bg-[var(--stgm-foreground,#1a1a2e)] stg:text-[var(--stgm-background,#fff)]"
          : "stg:bg-[var(--stgm-muted,#f5f5f5)] stg:text-[var(--stgm-muted-foreground,#737373)] stg:hover:bg-[var(--stgm-border,#e5e5e5)]",
      )}
    >
      {label} ({count})
    </button>
  );
}

const TASK_STATUS_CONFIG = new Map<WorkflowTaskStatus, { label: string; colorClass: string }>([
  [WorkflowTaskStatus.WORKFLOW_TASK_STATUS_UNSPECIFIED, { label: "—", colorClass: "stg:text-[var(--stgm-muted-foreground,#737373)]" }],
  [WorkflowTaskStatus.WORKFLOW_TASK_PENDING, { label: "Pending", colorClass: "stg:text-[var(--stgm-muted-foreground,#737373)]" }],
  [WorkflowTaskStatus.WORKFLOW_TASK_IN_PROGRESS, { label: "Running", colorClass: "stg:text-[var(--stgm-foreground,#1a1a2e)]" }],
  [WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED, { label: "Completed", colorClass: "stg:text-[var(--stgm-success,#16a34a)]" }],
  [WorkflowTaskStatus.WORKFLOW_TASK_FAILED, { label: "Failed", colorClass: "stg:text-[var(--stgm-destructive,#dc2626)]" }],
  [WorkflowTaskStatus.WORKFLOW_TASK_SKIPPED, { label: "Skipped", colorClass: "stg:text-[var(--stgm-muted-foreground,#737373)]" }],
  [WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL, { label: "Waiting", colorClass: "stg:text-[var(--stgm-warning,#f59e0b)]" }],
]);

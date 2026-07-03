"use client";

import { memo, useMemo, useState, useCallback } from "react";
import { cn } from "@stigmer/theme";
import { WorkflowTaskStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { formatDuration, formatMicroUsd } from "../format-utils.js";
import type { TaskComparison, ExecutionComparison } from "./types.js";

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
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Filter controls */}
      <div className="flex items-center gap-1" role="tablist" aria-label="Task filter">
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
      <div className="overflow-x-auto rounded-md border border-[var(--stgm-border,#e5e5e5)]">
        <table className="w-full text-xs" aria-label="Task comparison">
          <thead>
            <tr className="border-b border-[var(--stgm-border,#e5e5e5)] bg-[var(--stgm-muted,#f5f5f5)]">
              <th className="px-3 py-2 text-left font-medium text-[var(--stgm-muted-foreground,#737373)]">
                Task
              </th>
              <th className="px-3 py-2 text-center font-medium text-[var(--stgm-muted-foreground,#737373)]">
                Base Status
              </th>
              <th className="px-3 py-2 text-center font-medium text-[var(--stgm-muted-foreground,#737373)]">
                Compare Status
              </th>
              <th className="px-3 py-2 text-right font-medium text-[var(--stgm-muted-foreground,#737373)]">
                Duration
              </th>
              <th className="px-3 py-2 text-right font-medium text-[var(--stgm-muted-foreground,#737373)]">
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-[var(--stgm-muted-foreground,#737373)]">
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
        <div className="mt-1 text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
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
        "border-b border-[var(--stgm-border,#e5e5e5)] last:border-b-0",
        task.statusChanged && "bg-[var(--stgm-destructive,#dc2626)]/5",
        isDivergencePoint && "ring-1 ring-inset ring-[var(--stgm-warning,#f59e0b)]/50",
      )}
    >
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          {isDivergencePoint && (
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--stgm-warning,#f59e0b)]"
              title="First point of divergence"
              aria-label="Divergence point"
            />
          )}
          <span className="font-medium text-[var(--stgm-foreground,#1a1a2e)]">
            {task.taskName}
          </span>
        </div>
      </td>
      <td className="px-3 py-2 text-center">
        <TaskStatusBadge status={task.baseStatus} />
      </td>
      <td className="px-3 py-2 text-center">
        <TaskStatusBadge status={task.compareStatus} />
      </td>
      <td className="px-3 py-2 text-right">
        <DurationCell task={task} />
      </td>
      <td className="px-3 py-2 text-right">
        <CostCell task={task} />
      </td>
    </tr>
  );
});

function TaskStatusBadge({ status }: { status: WorkflowTaskStatus }) {
  const config = TASK_STATUS_CONFIG.get(status) ?? { label: "Unknown", colorClass: "text-[var(--stgm-muted-foreground,#737373)]" };
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium", config.colorClass)}>
      {config.label}
    </span>
  );
}

function DurationCell({ task }: { task: TaskComparison }) {
  if (task.baseDurationMs == null && task.compareDurationMs == null) return <span>—</span>;

  const baseStr = task.baseDurationMs != null ? formatDuration(task.baseDurationMs) : "—";
  const compareStr = task.compareDurationMs != null ? formatDuration(task.compareDurationMs) : "—";

  if (task.durationDeltaMs == null || task.durationDeltaMs === 0) {
    return <span className="text-[var(--stgm-muted-foreground,#737373)]">{baseStr}</span>;
  }

  const sign = task.durationDeltaMs > 0 ? "+" : "−";
  const abs = Math.abs(task.durationDeltaMs);
  const deltaColor = task.durationDeltaMs > 0
    ? "text-[var(--stgm-destructive,#dc2626)]"
    : "text-[var(--stgm-success,#16a34a)]";

  return (
    <span className="flex flex-col items-end">
      <span className="text-[var(--stgm-foreground,#1a1a2e)]">{baseStr} / {compareStr}</span>
      <span className={cn("text-[10px]", deltaColor)}>
        {sign}{formatDuration(abs)}
      </span>
    </span>
  );
}

function CostCell({ task }: { task: TaskComparison }) {
  if (task.baseCostMicros === BIGINT_ZERO && task.compareCostMicros === BIGINT_ZERO) {
    return <span className="text-[var(--stgm-muted-foreground,#737373)]">—</span>;
  }

  const baseStr = task.baseCostMicros > BIGINT_ZERO ? formatMicroUsd(task.baseCostMicros) : "—";
  const compareStr = task.compareCostMicros > BIGINT_ZERO ? formatMicroUsd(task.compareCostMicros) : "—";
  const delta = task.baseCostMicros - task.compareCostMicros;

  if (delta === BIGINT_ZERO) {
    return <span className="text-[var(--stgm-muted-foreground,#737373)]">{baseStr}</span>;
  }

  return (
    <span className="text-[var(--stgm-foreground,#1a1a2e)]">{baseStr} / {compareStr}</span>
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
        "rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors",
        active
          ? "bg-[var(--stgm-foreground,#1a1a2e)] text-[var(--stgm-background,#fff)]"
          : "bg-[var(--stgm-muted,#f5f5f5)] text-[var(--stgm-muted-foreground,#737373)] hover:bg-[var(--stgm-border,#e5e5e5)]",
      )}
    >
      {label} ({count})
    </button>
  );
}

const TASK_STATUS_CONFIG = new Map<WorkflowTaskStatus, { label: string; colorClass: string }>([
  [WorkflowTaskStatus.WORKFLOW_TASK_STATUS_UNSPECIFIED, { label: "—", colorClass: "text-[var(--stgm-muted-foreground,#737373)]" }],
  [WorkflowTaskStatus.WORKFLOW_TASK_PENDING, { label: "Pending", colorClass: "text-[var(--stgm-muted-foreground,#737373)]" }],
  [WorkflowTaskStatus.WORKFLOW_TASK_IN_PROGRESS, { label: "Running", colorClass: "text-[var(--stgm-foreground,#1a1a2e)]" }],
  [WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED, { label: "Completed", colorClass: "text-[var(--stgm-success,#16a34a)]" }],
  [WorkflowTaskStatus.WORKFLOW_TASK_FAILED, { label: "Failed", colorClass: "text-[var(--stgm-destructive,#dc2626)]" }],
  [WorkflowTaskStatus.WORKFLOW_TASK_SKIPPED, { label: "Skipped", colorClass: "text-[var(--stgm-muted-foreground,#737373)]" }],
  [WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL, { label: "Waiting", colorClass: "text-[var(--stgm-warning,#f59e0b)]" }],
]);

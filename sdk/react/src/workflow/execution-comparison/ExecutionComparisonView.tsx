"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import { WorkflowExecutionPhaseBadge } from "../WorkflowExecutionPhaseBadge";
import { useExecutionComparison } from "./useExecutionComparison";
import { ComparisonSummaryCards } from "./ComparisonSummaryCards";
import { TaskComparisonTable } from "./TaskComparisonTable";

/** Props for {@link ExecutionComparisonView}. */
export interface ExecutionComparisonViewProps {
  /** The "baseline" execution ID (typically the run being investigated). */
  readonly baseExecutionId: string;
  /** The "compare" execution ID (typically a reference/successful run). */
  readonly compareExecutionId: string;
  /** Called when the user clicks "Back" to exit comparison mode. */
  readonly onBack: () => void;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Top-level composed comparison view showing summary deltas and a
 * per-task comparison table between two workflow executions.
 *
 * Self-contained: fetches both executions internally via
 * {@link useExecutionComparison}. Zero Console dependencies.
 *
 * Layout:
 * ```
 * Header (back button + execution labels)
 * ComparisonSummaryCards (4 delta cards)
 * TaskComparisonTable (per-task status/duration/cost)
 * ```
 *
 * @example
 * ```tsx
 * <ExecutionComparisonView
 *   baseExecutionId="wfx_failed_123"
 *   compareExecutionId="wfx_success_456"
 *   onBack={() => setCompareMode(false)}
 * />
 * ```
 */
export const ExecutionComparisonView = memo(function ExecutionComparisonView({
  baseExecutionId,
  compareExecutionId,
  onBack,
  className,
}: ExecutionComparisonViewProps) {
  const { comparison, isLoading, error } = useExecutionComparison({
    baseId: baseExecutionId,
    compareId: compareExecutionId,
  });

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center py-16", className)}>
        <span className="text-sm text-[var(--stgm-muted-foreground,#737373)]">
          Loading comparison...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-2 py-16", className)}>
        <span className="text-sm text-[var(--stgm-destructive,#dc2626)]">
          Failed to load executions
        </span>
        <span className="text-xs text-[var(--stgm-muted-foreground,#737373)]">
          {error.message}
        </span>
      </div>
    );
  }

  if (!comparison) return null;

  return (
    <section
      className={cn("flex flex-col gap-4", className)}
      aria-label="Execution comparison"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-[var(--stgm-muted-foreground,#737373)] hover:bg-[var(--stgm-muted,#f5f5f5)] hover:text-[var(--stgm-foreground,#1a1a2e)]"
          aria-label="Back to execution"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7.5 9L4.5 6l3-3" />
          </svg>
          Back
        </button>

        <div className="flex flex-1 items-center gap-2">
          <ExecutionLabel
            name={comparison.baseRow.name || baseExecutionId}
            phase={comparison.baseRow.phase}
            label="Base"
          />
          <span className="text-xs text-[var(--stgm-muted-foreground,#737373)]">vs</span>
          <ExecutionLabel
            name={comparison.compareRow.name || compareExecutionId}
            phase={comparison.compareRow.phase}
            label="Compare"
          />
        </div>
      </div>

      {/* Divergence callout */}
      {comparison.divergencePoint && (
        <div className="flex items-center gap-2 rounded-md border border-[var(--stgm-warning,#f59e0b)]/30 bg-[var(--stgm-warning,#f59e0b)]/5 px-3 py-2">
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--stgm-warning,#f59e0b)]" aria-hidden="true" />
          <span className="text-xs text-[var(--stgm-foreground,#1a1a2e)]">
            First divergence at <strong>{comparison.divergencePoint}</strong>
          </span>
        </div>
      )}

      {/* Summary cards */}
      <ComparisonSummaryCards comparison={comparison} />

      {/* Task table */}
      <TaskComparisonTable comparison={comparison} />
    </section>
  );
});

function ExecutionLabel({
  name,
  phase,
  label,
}: {
  name: string;
  phase: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--stgm-muted-foreground,#737373)]">
        {label}:
      </span>
      <WorkflowExecutionPhaseBadge phase={phase} />
      <span className="max-w-[10rem] truncate text-xs font-medium text-[var(--stgm-foreground,#1a1a2e)]" title={name}>
        {name}
      </span>
    </div>
  );
}

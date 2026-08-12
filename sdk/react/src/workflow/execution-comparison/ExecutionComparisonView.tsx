"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import { WorkflowExecutionPhaseBadge } from "../WorkflowExecutionPhaseBadge.js";
import { useExecutionComparison } from "./useExecutionComparison.js";
import { ComparisonSummaryCards } from "./ComparisonSummaryCards.js";
import { TaskComparisonTable } from "./TaskComparisonTable.js";
import { TruncatedText } from "../../internal/truncated-text.js";

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
      <div className={cn("stg:flex stg:items-center stg:justify-center stg:py-16", className)}>
        <span className="stg:text-sm stg:text-[var(--stgm-muted-foreground,#737373)]">
          Loading comparison...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("stg:flex stg:flex-col stg:items-center stg:justify-center stg:gap-2 stg:py-16", className)}>
        <span className="stg:text-sm stg:text-[var(--stgm-destructive,#dc2626)]">
          Failed to load executions
        </span>
        <span className="stg:text-xs stg:text-[var(--stgm-muted-foreground,#737373)]">
          {error.message}
        </span>
      </div>
    );
  }

  if (!comparison) return null;

  return (
    <section
      className={cn("stg:flex stg:flex-col stg:gap-4", className)}
      aria-label="Execution comparison"
    >
      {/* Header */}
      <div className="stg:flex stg:items-center stg:gap-3">
        <button
          type="button"
          onClick={onBack}
          className="stg:flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-2 stg:py-1 stg:text-xs stg:font-medium stg:text-[var(--stgm-muted-foreground,#737373)] stg:hover:bg-[var(--stgm-muted,#f5f5f5)] stg:hover:text-[var(--stgm-foreground,#1a1a2e)]"
          aria-label="Back to execution"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7.5 9L4.5 6l3-3" />
          </svg>
          Back
        </button>

        <div className="stg:flex stg:flex-1 stg:items-center stg:gap-2">
          <ExecutionLabel
            name={comparison.baseRow.name || baseExecutionId}
            phase={comparison.baseRow.phase}
            label="Base"
          />
          <span className="stg:text-xs stg:text-[var(--stgm-muted-foreground,#737373)]">vs</span>
          <ExecutionLabel
            name={comparison.compareRow.name || compareExecutionId}
            phase={comparison.compareRow.phase}
            label="Compare"
          />
        </div>
      </div>

      {/* Divergence callout */}
      {comparison.divergencePoint && (
        <div className="stg:flex stg:items-center stg:gap-2 stg:rounded-md stg:border stg:border-[var(--stgm-warning,#f59e0b)]/30 stg:bg-[var(--stgm-warning,#f59e0b)]/5 stg:px-3 stg:py-2">
          <span className="stg:inline-block stg:h-2 stg:w-2 stg:rounded-full stg:bg-[var(--stgm-warning,#f59e0b)]" aria-hidden="true" />
          <span className="stg:text-xs stg:text-[var(--stgm-foreground,#1a1a2e)]">
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
    <div className="stg:flex stg:items-center stg:gap-1.5">
      <span className="stg:text-[10px] stg:font-medium stg:uppercase stg:tracking-wide stg:text-[var(--stgm-muted-foreground,#737373)]">
        {label}:
      </span>
      <WorkflowExecutionPhaseBadge phase={phase} />
      <TruncatedText
        text={name}
        className="stg:max-w-[10rem] stg:text-xs stg:font-medium stg:text-[var(--stgm-foreground,#1a1a2e)]"
      />
    </div>
  );
}

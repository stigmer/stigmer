"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { ExecutionSummary } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";

/** Props for {@link WorkflowOverviewSummary}. */
export interface WorkflowOverviewSummaryProps {
  /** Aggregated summary data. `null` while loading or when unavailable. */
  readonly summary: ExecutionSummary | null;
  /** Whether the summary is still loading. */
  readonly isLoading: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Row of 4 stat cards displaying key workflow execution metrics.
 *
 * Cards: Total Executions, Success Rate, Avg Duration, Total Cost.
 *
 * Handles loading (skeleton), empty (no executions), and populated states.
 * All visual properties flow through `--stgm-*` design tokens.
 */
export const WorkflowOverviewSummary = memo(function WorkflowOverviewSummary({
  summary,
  isLoading,
  className,
}: WorkflowOverviewSummaryProps) {
  if (isLoading) {
    return (
      <div className={cn("stg:grid stg:grid-cols-2 stg:gap-3 stg:sm:grid-cols-4", className)}>
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  const totalCount = typeof summary?.totalCount === "number" ? summary.totalCount : 0;

  if (!summary || totalCount === 0) {
    return (
      <div className={cn(
        "stg:rounded-lg stg:border stg:border-[var(--stgm-border,#d4d4d8)] stg:px-4 stg:py-6 stg:text-center stg:text-sm stg:text-[var(--stgm-muted-foreground,#737373)]",
        className,
      )}>
        No executions yet
      </div>
    );
  }

  const successRate = typeof summary.successRate === "number" ? summary.successRate : -1;
  const successPct = successRate >= 0 ? `${Math.round(successRate * 100)}%` : "—";
  const successColor = successRate >= 0.9
    ? "stg:text-[var(--stgm-success,#22c55e)]"
    : successRate >= 0.7
      ? "stg:text-[var(--stgm-warning,#f59e0b)]"
      : "stg:text-[var(--stgm-destructive,#ef4444)]";

  const avgDuration = summary.avgDuration
    ? formatProtoSeconds(Number(summary.avgDuration.seconds))
    : "—";

  const totalCost = summary.totalCost
    ? `$${summary.totalCost.totalCostUsd.toFixed(2)}`
    : "$0.00";

  return (
    <div className={cn("stg:grid stg:grid-cols-2 stg:gap-3 stg:sm:grid-cols-4", className)}>
      <StatCard label="Total Executions" value={String(totalCount)} />
      <StatCard label="Success Rate" value={successPct} valueClassName={successRate >= 0 ? successColor : undefined} />
      <StatCard label="Avg Duration" value={avgDuration} />
      <StatCard label="Total Cost" value={totalCost} />
    </div>
  );
});

function StatCard({
  label,
  value,
  valueClassName,
}: {
  readonly label: string;
  readonly value: string;
  readonly valueClassName?: string;
}) {
  return (
    <div className="stg:rounded-lg stg:border stg:border-[var(--stgm-border,#d4d4d8)] stg:bg-[var(--stgm-background,#fff)] stg:px-4 stg:py-3">
      <dt className="stg:text-[11px] stg:font-medium stg:uppercase stg:tracking-wider stg:text-[var(--stgm-muted-foreground,#737373)]">
        {label}
      </dt>
      <dd className={cn("stg:mt-1 stg:text-xl stg:font-semibold stg:text-[var(--stgm-foreground,#1a1a2e)]", valueClassName)}>
        {value}
      </dd>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="stg:rounded-lg stg:border stg:border-[var(--stgm-border,#d4d4d8)] stg:bg-[var(--stgm-background,#fff)] stg:px-4 stg:py-3">
      <div className="stg:h-3 stg:w-20 stg:animate-pulse stg:rounded stg:bg-[var(--stgm-muted,#e5e5e5)]" />
      <div className="stg:mt-2 stg:h-6 stg:w-16 stg:animate-pulse stg:rounded stg:bg-[var(--stgm-muted,#e5e5e5)]" />
    </div>
  );
}

function formatProtoSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

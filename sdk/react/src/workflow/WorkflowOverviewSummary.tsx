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
      <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4", className)}>
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (!summary || summary.totalCount === 0) {
    return (
      <div className={cn(
        "rounded-lg border border-[var(--stgm-border,#d4d4d8)] px-4 py-6 text-center text-sm text-[var(--stgm-muted-foreground,#737373)]",
        className,
      )}>
        No executions yet
      </div>
    );
  }

  const successRate = summary.successRate;
  const successPct = successRate >= 0 ? `${Math.round(successRate * 100)}%` : "—";
  const successColor = successRate >= 0.9
    ? "text-[var(--stgm-success,#22c55e)]"
    : successRate >= 0.7
      ? "text-[var(--stgm-warning,#f59e0b)]"
      : "text-[var(--stgm-destructive,#ef4444)]";

  const avgDuration = summary.avgDuration
    ? formatProtoSeconds(Number(summary.avgDuration.seconds))
    : "—";

  const totalCost = summary.totalCost
    ? `$${summary.totalCost.totalCostUsd.toFixed(2)}`
    : "$0.00";

  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4", className)}>
      <StatCard label="Total Executions" value={String(summary.totalCount)} />
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
    <div className="rounded-lg border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-4 py-3">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-[var(--stgm-muted-foreground,#737373)]">
        {label}
      </dt>
      <dd className={cn("mt-1 text-xl font-semibold text-[var(--stgm-foreground,#1a1a2e)]", valueClassName)}>
        {value}
      </dd>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-4 py-3">
      <div className="h-3 w-20 animate-pulse rounded bg-[var(--stgm-muted,#e5e5e5)]" />
      <div className="mt-2 h-6 w-16 animate-pulse rounded bg-[var(--stgm-muted,#e5e5e5)]" />
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

"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { ExecutionSummary } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { formatDurationSec, formatTokenCount } from "../format-utils.js";

/** Props for {@link HealthMetricsStrip}. */
export interface HealthMetricsStripProps {
  /** Aggregated summary from `useWorkflowDashboardSummary`. `null` while loading. */
  readonly summary: ExecutionSummary | null;
  /** Whether the summary is still loading. */
  readonly isLoading?: boolean;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Compact horizontal strip of key operational health metrics.
 *
 * Designed for the execution history page context where vertical space
 * is at a premium. Displays 6 metrics in a single row with dividers:
 * Total, Success Rate, Avg Duration, Total Cost, Active, Tokens.
 *
 * Data comes from the existing `ExecutionSummary` proto — no new APIs
 * needed. Loading state shows a skeleton strip.
 *
 * @example
 * ```tsx
 * const { summary, isLoading } = useWorkflowDashboardSummary({ org });
 * <HealthMetricsStrip summary={summary} isLoading={isLoading} />
 * ```
 */
export const HealthMetricsStrip = memo(function HealthMetricsStrip({
  summary,
  isLoading = false,
  className,
}: HealthMetricsStripProps) {
  if (isLoading) {
    return (
      <div
        className={cn(
          "flex items-center gap-4 overflow-x-auto rounded-lg border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-4 py-2.5",
          className,
        )}
        aria-label="Loading health metrics"
      >
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-3 w-12 animate-pulse rounded bg-[var(--stgm-muted,#e5e5e5)]" />
            <div className="h-4 w-8 animate-pulse rounded bg-[var(--stgm-muted,#e5e5e5)]" />
          </div>
        ))}
      </div>
    );
  }

  if (!summary) return null;

  const totalCount = summary.totalCount ?? 0;
  const activeCount = summary.activeCount ?? 0;
  const successRate = typeof summary.successRate === "number" ? summary.successRate : -1;

  const successPct = successRate >= 0 ? `${Math.round(successRate * 100)}%` : "\u2014";
  const successColor = successRate >= 0.9
    ? "text-[var(--stgm-success,#22c55e)]"
    : successRate >= 0.7
      ? "text-[var(--stgm-warning,#f59e0b)]"
      : successRate >= 0
        ? "text-[var(--stgm-destructive,#ef4444)]"
        : "";

  const avgDuration = summary.avgDuration
    ? formatDurationSec(Number(summary.avgDuration.seconds))
    : "\u2014";

  const totalCostUsd = summary.totalCost
    ? `$${summary.totalCost.totalCostUsd.toFixed(2)}`
    : "$0.00";

  const totalInputTokens = BigInt(summary.totalCost?.totalInputTokens ?? 0);
  const totalOutputTokens = BigInt(summary.totalCost?.totalOutputTokens ?? 0);
  const totalTokens = totalInputTokens + totalOutputTokens;

  return (
    <div
      role="region"
      aria-label="Execution health metrics"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-4 py-2.5",
        className,
      )}
    >
      <Metric label="Total" value={String(totalCount)} />
      <Divider />
      <Metric label="Success" value={successPct} valueClassName={successColor} />
      <Divider />
      <Metric label="Avg Duration" value={avgDuration} />
      <Divider />
      <Metric label="Cost" value={totalCostUsd} />
      <Divider />
      <Metric
        label="Active"
        value={String(activeCount)}
        valueClassName={activeCount > 0 ? "text-[var(--stgm-primary,#6366f1)]" : ""}
        badge={activeCount > 0 ? <LiveDot /> : undefined}
      />
      <Divider />
      <Metric
        label="Tokens"
        value={totalTokens > BigInt(0) ? formatTokenCount(totalTokens) : "\u2014"}
      />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Metric({
  label,
  value,
  valueClassName,
  badge,
}: {
  readonly label: string;
  readonly value: string;
  readonly valueClassName?: string;
  readonly badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[11px] font-medium text-[var(--stgm-muted-foreground,#737373)] whitespace-nowrap">
        {label}
      </span>
      <span className={cn("text-sm font-semibold tabular-nums text-[var(--stgm-foreground,#1a1a2e)]", valueClassName)}>
        {value}
      </span>
      {badge}
    </div>
  );
}

function Divider() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-px shrink-0 bg-[var(--stgm-border,#d4d4d8)]"
    />
  );
}

function LiveDot() {
  return (
    <span className="relative inline-flex h-1.5 w-1.5" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--stgm-primary,#6366f1)] opacity-75" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--stgm-primary,#6366f1)]" />
    </span>
  );
}

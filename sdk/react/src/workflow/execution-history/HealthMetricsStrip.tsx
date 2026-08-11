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
          "stg:flex stg:items-center stg:gap-4 stg:overflow-x-auto stg:rounded-lg stg:border stg:border-[var(--stgm-border,#d4d4d8)] stg:bg-[var(--stgm-background,#fff)] stg:px-4 stg:py-2.5",
          className,
        )}
        aria-label="Loading health metrics"
      >
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="stg:flex stg:items-center stg:gap-2">
            <div className="stg:h-3 stg:w-12 stg:animate-pulse stg:rounded stg:bg-[var(--stgm-muted,#e5e5e5)]" />
            <div className="stg:h-4 stg:w-8 stg:animate-pulse stg:rounded stg:bg-[var(--stgm-muted,#e5e5e5)]" />
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
    ? "stg:text-[var(--stgm-success,#22c55e)]"
    : successRate >= 0.7
      ? "stg:text-[var(--stgm-warning,#f59e0b)]"
      : successRate >= 0
        ? "stg:text-[var(--stgm-destructive,#ef4444)]"
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
        "stg:flex stg:flex-wrap stg:items-center stg:gap-x-4 stg:gap-y-1 stg:rounded-lg stg:border stg:border-[var(--stgm-border,#d4d4d8)] stg:bg-[var(--stgm-background,#fff)] stg:px-4 stg:py-2.5",
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
        valueClassName={activeCount > 0 ? "stg:text-[var(--stgm-primary,#6366f1)]" : ""}
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
    <div className="stg:flex stg:items-baseline stg:gap-1.5">
      <span className="stg:text-[11px] stg:font-medium stg:text-[var(--stgm-muted-foreground,#737373)] stg:whitespace-nowrap">
        {label}
      </span>
      <span className={cn("stg:text-sm stg:font-semibold stg:tabular-nums stg:text-[var(--stgm-foreground,#1a1a2e)]", valueClassName)}>
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
      className="stg:h-4 stg:w-px stg:shrink-0 stg:bg-[var(--stgm-border,#d4d4d8)]"
    />
  );
}

function LiveDot() {
  return (
    <span className="stg:relative stg:inline-flex stg:h-1.5 stg:w-1.5" aria-hidden="true">
      <span className="stg:absolute stg:inline-flex stg:h-full stg:w-full stg:animate-ping stg:rounded-full stg:bg-[var(--stgm-primary,#6366f1)] stg:opacity-75" />
      <span className="stg:relative stg:inline-flex stg:h-1.5 stg:w-1.5 stg:rounded-full stg:bg-[var(--stgm-primary,#6366f1)]" />
    </span>
  );
}

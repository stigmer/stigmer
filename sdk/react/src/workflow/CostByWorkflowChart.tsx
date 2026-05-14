"use client";

import { memo, useMemo } from "react";
import { cn } from "@stigmer/theme";
import type { WorkflowCostBreakdown } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";

export interface CostByWorkflowChartProps {
  readonly breakdowns: readonly WorkflowCostBreakdown[];
  readonly isLoading: boolean;
  readonly className?: string;
}

const BAR_COLORS = [
  "var(--stgm-color-primary, var(--color-primary))",
  "var(--stgm-color-success, var(--color-success))",
  "var(--stgm-color-warning, var(--color-warning))",
  "var(--stgm-color-destructive, var(--color-destructive))",
  "var(--stgm-color-muted-foreground, var(--color-muted-foreground))",
];

function formatCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  if (usd > 0) return `<$0.01`;
  return "$0.00";
}

/**
 * Horizontal bar chart showing cost by workflow.
 *
 * Sorted by total cost (descending). Each bar shows the workflow name,
 * formatted dollar cost, and execution count as a secondary label.
 * Uses pure CSS for rendering -- no recharts dependency needed.
 */
export const CostByWorkflowChart = memo(function CostByWorkflowChart({
  breakdowns,
  isLoading,
  className,
}: CostByWorkflowChartProps) {
  const sorted = useMemo(
    () =>
      [...breakdowns]
        .sort((a, b) => b.totalCostUsd - a.totalCostUsd)
        .slice(0, 8),
    [breakdowns],
  );

  const maxCost = useMemo(
    () => Math.max(Number.MIN_VALUE, ...sorted.map((b) => b.totalCostUsd)),
    [sorted],
  );

  if (isLoading) {
    return (
      <div className={cn("space-y-3", className)} aria-busy="true">
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-1">
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            <div
              className="h-6 animate-pulse rounded bg-muted/50"
              style={{ width: `${80 - i * 15}%` }}
            />
          </div>
        ))}
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className={cn("space-y-3", className)}>
        <h3 className="text-sm font-semibold text-foreground">
          Cost by Workflow
        </h3>
        <p className="py-6 text-center text-xs text-muted-foreground">
          No cost data available
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <h3 className="text-sm font-semibold text-foreground">
        Cost by Workflow
      </h3>
      <div className="space-y-2.5" role="list" aria-label="Cost by workflow">
        {sorted.map((breakdown, i) => {
          const pct = maxCost > 0 ? (breakdown.totalCostUsd / maxCost) * 100 : 0;
          const color = BAR_COLORS[i % BAR_COLORS.length];

          return (
            <div key={breakdown.workflowSlug} role="listitem">
              <div className="mb-0.5 flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium text-foreground">
                  {breakdown.workflowName || breakdown.workflowSlug}
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="text-xs font-medium tabular-nums text-foreground">
                    {formatCost(breakdown.totalCostUsd)}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {breakdown.executionCount} runs
                  </span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

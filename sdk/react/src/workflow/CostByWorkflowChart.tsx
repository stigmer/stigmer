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
      <div className={cn("stg:space-y-3", className)} aria-busy="true">
        <div className="stg:h-4 stg:w-40 stg:animate-pulse stg:rounded stg:bg-muted" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="stg:space-y-1">
            <div className="stg:h-3 stg:w-24 stg:animate-pulse stg:rounded stg:bg-muted" />
            <div
              className="stg:h-6 stg:animate-pulse stg:rounded stg:bg-muted/50"
              style={{ width: `${80 - i * 15}%` }}
            />
          </div>
        ))}
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className={cn("stg:space-y-3", className)}>
        <h3 className="stg:text-sm stg:font-semibold stg:text-foreground">
          Cost by Workflow
        </h3>
        <p className="stg:py-6 stg:text-center stg:text-xs stg:text-muted-foreground">
          No cost data available
        </p>
      </div>
    );
  }

  return (
    <div className={cn("stg:space-y-3", className)}>
      <h3 className="stg:text-sm stg:font-semibold stg:text-foreground">
        Cost by Workflow
      </h3>
      <div className="stg:space-y-2.5" role="list" aria-label="Cost by workflow">
        {sorted.map((breakdown, i) => {
          const pct = maxCost > 0 ? (breakdown.totalCostUsd / maxCost) * 100 : 0;
          const color = BAR_COLORS[i % BAR_COLORS.length];

          return (
            <div key={breakdown.workflowSlug} role="listitem">
              <div className="stg:mb-0.5 stg:flex stg:items-baseline stg:justify-between stg:gap-2">
                <span className="stg:truncate stg:text-xs stg:font-medium stg:text-foreground">
                  {breakdown.workflowName || breakdown.workflowSlug}
                </span>
                <span className="stg:flex stg:shrink-0 stg:items-baseline stg:gap-2">
                  <span className="stg:text-xs stg:font-medium stg:tabular-nums stg:text-foreground">
                    {formatCost(breakdown.totalCostUsd)}
                  </span>
                  <span className="stg:text-xs stg:tabular-nums stg:text-muted-foreground">
                    {breakdown.executionCount} runs
                  </span>
                </span>
              </div>
              <div className="stg:h-2 stg:overflow-hidden stg:rounded-full stg:bg-muted">
                <div
                  className="stg:h-full stg:rounded-full stg:transition-all stg:duration-500"
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

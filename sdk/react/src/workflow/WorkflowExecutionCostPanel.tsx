"use client";

import { memo, useMemo } from "react";
import { cn } from "@stigmer/theme";
import type { DerivedCostSummary } from "../internal/store/workflow-execution-event-store";

/** Props for {@link WorkflowExecutionCostPanel}. */
export interface WorkflowExecutionCostPanelProps {
  /** Derived cost summary from the event store. */
  readonly costSummary: DerivedCostSummary;
  /** Maximum cost budget in micro-USD from the workflow spec. -1 if no limit. */
  readonly maxCostMicros?: bigint;
  /** Maximum token budget from the workflow spec. -1 if no limit. */
  readonly maxTokens?: bigint;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Sidebar panel showing budget consumption with progress bars
 * for cost and tokens.
 */
export const WorkflowExecutionCostPanel = memo(function WorkflowExecutionCostPanel({
  costSummary,
  maxCostMicros,
  maxTokens,
  className,
}: WorkflowExecutionCostPanelProps) {
  const BZ = BigInt(0);
  const hasCost = costSummary.costConsumedMicros > BZ;
  const hasTokens = costSummary.tokensConsumed > BZ;

  const costLimit = maxCostMicros ?? (costSummary.costRemainingMicros >= BZ
    ? costSummary.costConsumedMicros + costSummary.costRemainingMicros
    : undefined);

  const tokenLimit = maxTokens ?? (costSummary.tokensRemaining >= BZ
    ? costSummary.tokensConsumed + costSummary.tokensRemaining
    : undefined);

  if (!hasCost && !hasTokens) return null;

  return (
    <div className={cn("flex flex-col gap-3 px-3 py-2", className)}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Budget
      </h3>

      {hasCost && (
        <BudgetGauge
          label="Cost"
          consumed={formatMicroUsd(costSummary.costConsumedMicros)}
          limit={costLimit ? formatMicroUsd(costLimit) : undefined}
          percentage={costLimit && costLimit > BZ
            ? Number((costSummary.costConsumedMicros * BigInt(100)) / costLimit)
            : undefined}
          breached={costSummary.thresholdBreached}
        />
      )}

      {hasTokens && (
        <BudgetGauge
          label="Tokens"
          consumed={formatTokens(costSummary.tokensConsumed)}
          limit={tokenLimit ? formatTokens(tokenLimit) : undefined}
          percentage={tokenLimit && tokenLimit > BZ
            ? Number((costSummary.tokensConsumed * BigInt(100)) / tokenLimit)
            : undefined}
          breached={costSummary.thresholdBreached}
        />
      )}
    </div>
  );
});

function BudgetGauge({
  label,
  consumed,
  limit,
  percentage,
  breached,
}: {
  readonly label: string;
  readonly consumed: string;
  readonly limit?: string;
  readonly percentage?: number;
  readonly breached: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("tabular-nums", breached ? "text-warning" : "text-foreground")}>
          {consumed}
          {limit && <span className="text-muted-foreground"> / {limit}</span>}
        </span>
      </div>

      {percentage !== undefined && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              breached ? "bg-warning" : percentage > 80 ? "bg-warning" : "bg-primary",
            )}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
      )}

      {percentage !== undefined && (
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {percentage.toFixed(0)}%
        </span>
      )}
    </div>
  );
}

function formatMicroUsd(micros: bigint): string {
  const val = Number(micros) / 1_000_000;
  if (val < 0.01) return `$${val.toFixed(4)}`;
  return `$${val.toFixed(2)}`;
}

function formatTokens(tokens: bigint): string {
  const n = Number(tokens);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

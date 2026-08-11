"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import { formatDuration, formatMicroUsd, formatTokenCount } from "../format-utils.js";
import type { ExecutionComparison } from "./types.js";

/** Props for {@link ComparisonSummaryCards}. */
export interface ComparisonSummaryCardsProps {
  readonly comparison: ExecutionComparison;
  readonly className?: string;
}

interface CardData {
  readonly label: string;
  readonly baseValue: string;
  readonly compareValue: string;
  readonly delta: string;
  readonly deltaDirection: "better" | "worse" | "neutral";
}

const BIGINT_ZERO = BigInt(0);

/**
 * Renders 4 summary cards showing execution-level deltas between
 * the base and compare runs: Duration, Cost, Tokens, and Task Outcomes.
 *
 * Positive delta values are color-coded: green = compare was better,
 * red = compare was worse, neutral gray = equal.
 */
export const ComparisonSummaryCards = memo(function ComparisonSummaryCards({
  comparison,
  className,
}: ComparisonSummaryCardsProps) {
  const cards = buildCards(comparison);

  return (
    <div
      className={cn("stg:grid stg:grid-cols-2 stg:gap-3 stg:lg:grid-cols-4", className)}
      aria-label="Comparison summary"
    >
      {cards.map((card) => (
        <div
          key={card.label}
          className="stg:rounded-lg stg:border stg:border-[var(--stgm-border,#e5e5e5)] stg:bg-[var(--stgm-card,#fff)] stg:p-3"
        >
          <span className="stg:text-[10px] stg:font-medium stg:uppercase stg:tracking-wide stg:text-[var(--stgm-muted-foreground,#737373)]">
            {card.label}
          </span>
          <div className="stg:mt-1.5 stg:flex stg:items-baseline stg:gap-2">
            <span className="stg:text-sm stg:font-semibold stg:text-[var(--stgm-foreground,#1a1a2e)]">
              {card.baseValue}
            </span>
            <span className="stg:text-[10px] stg:text-[var(--stgm-muted-foreground,#737373)]">
              vs {card.compareValue}
            </span>
          </div>
          <div className="stg:mt-1">
            <span
              className={cn(
                "stg:text-xs stg:font-medium",
                card.deltaDirection === "better" && "stg:text-[var(--stgm-success,#16a34a)]",
                card.deltaDirection === "worse" && "stg:text-[var(--stgm-destructive,#dc2626)]",
                card.deltaDirection === "neutral" && "stg:text-[var(--stgm-muted-foreground,#737373)]",
              )}
            >
              {card.delta}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
});

function buildCards(comparison: ExecutionComparison): CardData[] {
  const { baseRow, compareRow, durationDeltaMs, costDeltaMicros, tokensDelta } = comparison;

  const durationCard: CardData = {
    label: "Duration",
    baseValue: baseRow.durationMs != null ? formatDuration(baseRow.durationMs) : "—",
    compareValue: compareRow.durationMs != null ? formatDuration(compareRow.durationMs) : "—",
    delta: formatDelta(durationDeltaMs, (ms) => formatDuration(Math.abs(ms))),
    deltaDirection: durationDeltaMs == null ? "neutral" : durationDeltaMs > 0 ? "worse" : durationDeltaMs < 0 ? "better" : "neutral",
  };

  const costCard: CardData = {
    label: "Cost",
    baseValue: baseRow.costMicros > BIGINT_ZERO ? formatMicroUsd(baseRow.costMicros) : "—",
    compareValue: compareRow.costMicros > BIGINT_ZERO ? formatMicroUsd(compareRow.costMicros) : "—",
    delta: formatBigintDelta(costDeltaMicros, formatMicroUsd),
    deltaDirection: costDeltaMicros === BIGINT_ZERO ? "neutral" : costDeltaMicros > BIGINT_ZERO ? "worse" : "better",
  };

  const tokensCard: CardData = {
    label: "Tokens",
    baseValue: baseRow.totalTokens > BIGINT_ZERO ? formatTokenCount(baseRow.totalTokens) : "—",
    compareValue: compareRow.totalTokens > BIGINT_ZERO ? formatTokenCount(compareRow.totalTokens) : "—",
    delta: formatBigintDelta(tokensDelta, formatTokenCount),
    deltaDirection: tokensDelta === BIGINT_ZERO ? "neutral" : tokensDelta > BIGINT_ZERO ? "worse" : "better",
  };

  const baseChanged = comparison.tasks.filter((t) => t.statusChanged).length;
  const tasksCard: CardData = {
    label: "Task Outcomes",
    baseValue: `${baseRow.completedTaskCount}/${baseRow.taskCount}`,
    compareValue: `${compareRow.completedTaskCount}/${compareRow.taskCount}`,
    delta: baseChanged === 0 ? "All identical" : `${baseChanged} differ`,
    deltaDirection: baseChanged === 0 ? "neutral" : "worse",
  };

  return [durationCard, costCard, tokensCard, tasksCard];
}

function formatDelta(value: number | null, formatter: (v: number) => string): string {
  if (value == null) return "—";
  if (value === 0) return "No change";
  const sign = value > 0 ? "+" : "−";
  return `${sign}${formatter(Math.abs(value))}`;
}

function formatBigintDelta(value: bigint, formatter: (v: bigint) => string): string {
  if (value === BIGINT_ZERO) return "No change";
  const sign = value > BIGINT_ZERO ? "+" : "−";
  const abs = value < BIGINT_ZERO ? -value : value;
  return `${sign}${formatter(abs)}`;
}

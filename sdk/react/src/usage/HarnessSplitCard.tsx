"use client";

import { cn } from "@stigmer/theme";
import type { HarnessCostSummary } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { formatCost } from "../execution/UsageWidget.js";

/** Props for {@link HarnessSplitCard}. */
export interface HarnessSplitCardProps {
  /** Harness breakdown entries from the org usage report. */
  readonly breakdown: readonly HarnessCostSummary[];
  /** Additional CSS class names. */
  readonly className?: string;
}

const HARNESS_LABELS: Record<string, string> = {
  native: "Native",
  cursor: "Cursor",
};

const HARNESS_COLORS: Record<string, string> = {
  native: "stg:bg-chart-1",
  cursor: "stg:bg-chart-3",
};

/**
 * Displays the cost split between execution harnesses as a segmented bar.
 *
 * Renders a two-tone horizontal bar with labels showing cost and percentage
 * per harness. Designed for at-a-glance understanding of native vs cursor
 * cost distribution.
 */
export function HarnessSplitCard({
  breakdown,
  className,
}: HarnessSplitCardProps) {
  if (breakdown.length === 0) return null;

  const totalCost = breakdown.reduce(
    (sum, h) => sum + Number(h.billableCostMicros),
    0,
  );

  if (totalCost <= 0) return null;

  return (
    <div className={className}>
      <h3 className="stg:mb-2 stg:text-xs stg:font-semibold stg:text-foreground">
        Harness Split
      </h3>
      <div className="stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-3.5 stg:py-3">
        {/* Segmented bar */}
        <div
          className="stg:flex stg:h-3 stg:w-full stg:overflow-hidden stg:rounded-full"
          role="img"
          aria-label="Cost distribution by harness"
        >
          {breakdown.map((entry) => {
            const cost = Number(entry.billableCostMicros);
            const pct = (cost / totalCost) * 100;
            if (pct <= 0) return null;
            return (
              <div
                key={entry.harness}
                className={cn(
                  "stg:transition-all",
                  HARNESS_COLORS[entry.harness] ?? "stg:bg-chart-4",
                )}
                style={{ width: `${pct}%` }}
              />
            );
          })}
        </div>

        {/* Labels */}
        <div className="stg:mt-2.5 stg:flex stg:flex-wrap stg:gap-x-5 stg:gap-y-1">
          {breakdown.map((entry) => {
            const cost = Number(entry.billableCostMicros);
            const pct = totalCost > 0 ? (cost / totalCost) * 100 : 0;
            return (
              <div key={entry.harness} className="stg:flex stg:items-center stg:gap-1.5">
                <div
                  className={cn(
                    "stg:size-2 stg:rounded-full",
                    HARNESS_COLORS[entry.harness] ?? "stg:bg-chart-4",
                  )}
                />
                <span className="stg:text-xs stg:text-muted-foreground">
                  {HARNESS_LABELS[entry.harness] ?? entry.harness}
                </span>
                <span className="stg:text-xs stg:tabular-nums stg:font-medium stg:text-foreground">
                  {formatCost(cost / 1_000_000)}
                </span>
                <span className="stg:text-[0.6rem] stg:tabular-nums stg:text-muted-foreground">
                  ({pct.toFixed(0)}%)
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

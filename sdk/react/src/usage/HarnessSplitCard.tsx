"use client";

import { cn } from "@stigmer/theme";
import type { HarnessCostSummary } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { formatCost } from "../execution/UsageWidget";

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
  native: "bg-chart-1",
  cursor: "bg-chart-3",
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
      <h3 className="mb-2 text-xs font-semibold text-foreground">
        Harness Split
      </h3>
      <div className="rounded-lg border border-border bg-card px-3.5 py-3">
        {/* Segmented bar */}
        <div
          className="flex h-3 w-full overflow-hidden rounded-full"
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
                  "transition-all",
                  HARNESS_COLORS[entry.harness] ?? "bg-chart-4",
                )}
                style={{ width: `${pct}%` }}
              />
            );
          })}
        </div>

        {/* Labels */}
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
          {breakdown.map((entry) => {
            const cost = Number(entry.billableCostMicros);
            const pct = totalCost > 0 ? (cost / totalCost) * 100 : 0;
            return (
              <div key={entry.harness} className="flex items-center gap-1.5">
                <div
                  className={cn(
                    "size-2 rounded-full",
                    HARNESS_COLORS[entry.harness] ?? "bg-chart-4",
                  )}
                />
                <span className="text-xs text-muted-foreground">
                  {HARNESS_LABELS[entry.harness] ?? entry.harness}
                </span>
                <span className="text-xs tabular-nums font-medium text-foreground">
                  {formatCost(cost / 1_000_000)}
                </span>
                <span className="text-[0.6rem] tabular-nums text-muted-foreground">
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

"use client";

/**
 * Harness split: the organization's tokens and calls per run harness
 * (native, Cursor) as a segmented bar with labelled shares.
 *
 * Segments are sized by tokens, the one measure every run has (a run
 * counted from its runner's own report has tokens and no metered calls).
 * Usage is tokens, never money. The suite in
 * `__tests__/HarnessSplitCard.test.tsx` pins the labels, shares and the
 * empty case.
 */

import { cn } from "@stigmer/theme";
import type { HarnessUsage } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { formatCalls, formatTokens, sharePercent } from "./format.js";

/** Props for {@link HarnessSplitCard}. */
export interface HarnessSplitCardProps {
  /** Harness breakdown entries from the org usage report. */
  readonly breakdown: readonly HarnessUsage[];
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
 * Displays the token split between run harnesses as a segmented bar.
 *
 * Renders a horizontal bar with labels showing tokens, calls and share per
 * harness, for an at-a-glance read of native vs Cursor usage.
 */
export function HarnessSplitCard({
  breakdown,
  className,
}: HarnessSplitCardProps) {
  if (breakdown.length === 0) return null;

  const totalTokens = breakdown.reduce(
    (sum, h) => sum + Number(h.totalTokens),
    0,
  );

  if (totalTokens <= 0) return null;

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
          aria-label="Token distribution by harness"
        >
          {breakdown.map((entry) => {
            const pct = (Number(entry.totalTokens) / totalTokens) * 100;
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
            const pct = sharePercent(entry.totalTokens, totalTokens);
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
                  {formatTokens(entry.totalTokens)}
                </span>
                <span className="stg:text-[0.6rem] stg:tabular-nums stg:text-muted-foreground">
                  {formatCalls(entry.callCount)} ({pct}%)
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

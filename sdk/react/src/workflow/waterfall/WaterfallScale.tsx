"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { WaterfallScale as WaterfallScaleData } from "../execution/derive-waterfall-entries.js";
import { formatDuration } from "../format-utils.js";

export interface WaterfallScaleProps {
  readonly scale: WaterfallScaleData;
  readonly className?: string;
}

/**
 * Time axis for the waterfall timeline.
 *
 * Renders tick marks with duration labels at computed intervals.
 * Labels adapt density based on the scale's `labelEveryN` to
 * prevent overlapping text on dense scales.
 */
export const WaterfallScaleComponent = memo(function WaterfallScaleComponent({
  scale,
  className,
}: WaterfallScaleProps) {
  if (scale.ticks.length === 0) return null;

  return (
    <div
      className={cn("relative h-5 shrink-0 select-none border-b border-[var(--stgm-border,#e5e5e5)]", className)}
      aria-hidden="true"
    >
      {scale.ticks.map((tickMs, i) => {
        const pct = (tickMs / scale.totalMs) * 100;
        const showLabel = i % scale.labelEveryN === 0;

        return (
          <div
            key={tickMs}
            className="absolute top-0 h-full"
            style={{ left: `${pct}%` }}
          >
            <div className="h-1.5 w-px bg-[var(--stgm-border,#e5e5e5)]" />
            {showLabel && (
              <span className="absolute top-1.5 -translate-x-1/2 whitespace-nowrap text-[9px] tabular-nums text-[var(--stgm-muted-foreground,#737373)]">
                {formatDuration(tickMs)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
});

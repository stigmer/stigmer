"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { WaterfallEntry } from "../execution/derive-waterfall-entries.js";
import { formatDuration, formatMicroUsd, formatTokenCount } from "../format-utils.js";

export interface WaterfallTooltipProps {
  readonly entry: WaterfallEntry;
  readonly nowMs: number;
  readonly className?: string;
}

const BIGINT_ZERO = BigInt(0);

/**
 * Tooltip content for a waterfall bar hover.
 *
 * Shows task name, kind, status, duration, cost, and tokens in a
 * compact layout. Designed to be placed in a popover/tooltip container
 * by the parent component.
 */
export const WaterfallTooltip = memo(function WaterfallTooltip({
  entry,
  nowMs,
  className,
}: WaterfallTooltipProps) {
  const effectiveDuration = entry.endMs != null
    ? entry.endMs - entry.startMs
    : nowMs - entry.startMs;

  return (
    <div className={cn("space-y-1 text-[11px]", className)}>
      <div className="font-medium text-[var(--stgm-popover-foreground,#171717)]">
        {entry.taskName}
      </div>

      <div className="text-[var(--stgm-muted-foreground,#737373)]">
        {entry.status}
        {entry.attempts.length > 1 && ` (${entry.attempts.length} attempts)`}
      </div>

      {entry.status !== "skipped" && entry.status !== "not_reached" && (
        <div className="tabular-nums text-[var(--stgm-popover-foreground,#171717)]">
          {formatDuration(entry.durationMs || effectiveDuration)}
        </div>
      )}

      {entry.costMicros > BIGINT_ZERO && (
        <div className="tabular-nums text-[var(--stgm-popover-foreground,#171717)]">
          {formatMicroUsd(entry.costMicros)}
        </div>
      )}

      {entry.tokensUsed > BIGINT_ZERO && (
        <div className="tabular-nums text-[var(--stgm-popover-foreground,#171717)]">
          {formatTokenCount(entry.tokensUsed)} tokens
        </div>
      )}

      {entry.approvalWaitMs != null && entry.approvalWaitMs > 0 && (
        <div className="text-[var(--stgm-warning,#f59e0b)]">
          Approval wait: {formatDuration(entry.approvalWaitMs)}
        </div>
      )}

      {entry.children.length > 0 && (
        <div className="text-[var(--stgm-muted-foreground,#737373)]">
          {entry.children.length} agent call{entry.children.length > 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
});

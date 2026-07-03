"use client";

import { memo, useCallback } from "react";
import { cn } from "@stigmer/theme";
import type { WaterfallEntry } from "../execution/derive-waterfall-entries.js";
import { WaterfallBar } from "./WaterfallBar.js";
import { formatDuration, formatMicroUsd } from "../format-utils.js";

export interface WaterfallRowProps {
  readonly entry: WaterfallEntry;
  readonly totalMs: number;
  readonly nowMs: number;
  readonly isSelected: boolean;
  readonly onSelect: (taskName: string) => void;
  readonly className?: string;
}

const BIGINT_ZERO = BigInt(0);

/**
 * A single row in the waterfall: task label on the left, bar on the right.
 *
 * Wrapped in `React.memo` so only the actively-running row re-renders
 * during live streaming (DD-010). Selection state is the primary
 * re-render trigger for completed rows.
 */
export const WaterfallRow = memo(function WaterfallRow({
  entry,
  totalMs,
  nowMs,
  isSelected,
  onSelect,
  className,
}: WaterfallRowProps) {
  const handleClick = useCallback(() => {
    onSelect(entry.taskName);
  }, [onSelect, entry.taskName]);

  const effectiveDuration = entry.endMs != null
    ? entry.endMs - entry.startMs
    : nowMs - entry.startMs;

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "flex w-full items-center gap-2 px-2 py-0.5 text-left transition-colors hover:bg-[var(--stgm-muted,#f5f5f5)]",
        isSelected && "bg-[var(--stgm-accent,#f0f4ff)]",
        className,
      )}
      aria-label={`Task ${entry.taskName}, ${entry.status}, ${formatDuration(entry.durationMs || effectiveDuration)}`}
      data-task-name={entry.taskName}
    >
      {/* Label column */}
      <div className="flex w-36 shrink-0 items-center gap-1.5 overflow-hidden">
        <StatusDot status={entry.status} />
        <span className="truncate text-[11px] font-medium text-[var(--stgm-foreground,#171717)]">
          {entry.taskName}
        </span>
      </div>

      {/* Duration chip */}
      <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-[var(--stgm-muted-foreground,#737373)]">
        {entry.status === "skipped" || entry.status === "not_reached"
          ? "—"
          : formatDuration(entry.durationMs || effectiveDuration)}
      </span>

      {/* Cost chip (only when non-zero) */}
      <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-[var(--stgm-muted-foreground,#737373)]">
        {entry.costMicros > BIGINT_ZERO
          ? formatMicroUsd(entry.costMicros)
          : ""}
      </span>

      {/* Bar column */}
      <div className="min-w-0 flex-1">
        <WaterfallBar
          entry={entry}
          totalMs={totalMs}
          nowMs={nowMs}
        />
      </div>
    </button>
  );
});

// ---------------------------------------------------------------------------
// Status dot
// ---------------------------------------------------------------------------

function StatusDot({ status }: { readonly status: WaterfallEntry["status"] }) {
  const color = STATUS_DOT_COLORS[status] ?? "bg-[var(--stgm-muted,#d4d4d4)]";
  return (
    <span
      className={cn("inline-block size-1.5 shrink-0 rounded-full", color)}
      aria-hidden="true"
    />
  );
}

const STATUS_DOT_COLORS: Record<string, string> = {
  completed: "bg-[var(--stgm-success,#22c55e)]",
  running: "bg-[var(--stgm-primary,#3b82f6)]",
  failed: "bg-[var(--stgm-destructive,#ef4444)]",
  retrying: "bg-[var(--stgm-warning,#f59e0b)]",
  waiting_approval: "bg-[var(--stgm-warning,#f59e0b)]",
  skipped: "bg-[var(--stgm-muted,#d4d4d4)]",
  pending: "bg-[var(--stgm-muted,#d4d4d4)]",
  not_reached: "bg-[var(--stgm-muted,#d4d4d4)]",
};

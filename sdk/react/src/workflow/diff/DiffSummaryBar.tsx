"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { GraphDiff } from "./types";

export interface DiffSummaryBarProps {
  readonly diff: GraphDiff;
  readonly className?: string;
}

/**
 * Compact summary bar showing colored count badges for added, removed,
 * and modified nodes. Rendered at the top of the diff graph canvas.
 */
export const DiffSummaryBar = memo(function DiffSummaryBar({
  diff,
  className,
}: DiffSummaryBarProps) {
  const { added, removed, modified } = diff.summary;

  if (added === 0 && removed === 0 && modified === 0) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border border-[var(--stgm-border,#e5e5e5)] bg-[var(--stgm-card,var(--stgm-background,#fff))] px-3 py-1.5 text-xs text-[var(--stgm-muted-foreground,#737373)] shadow-sm",
          className,
        )}
      >
        No changes detected
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border border-[var(--stgm-border,#e5e5e5)] bg-[var(--stgm-card,var(--stgm-background,#fff))] px-3 py-1.5 text-xs font-medium shadow-sm",
        className,
      )}
      role="status"
      aria-label={`Diff summary: ${added} added, ${removed} removed, ${modified} modified`}
    >
      {added > 0 && (
        <span className="flex items-center gap-1 text-[var(--stgm-success,#22c55e)]">
          <span aria-hidden="true">+</span>
          {added} added
        </span>
      )}
      {removed > 0 && (
        <span className="flex items-center gap-1 text-[var(--stgm-destructive,#ef4444)]">
          <span aria-hidden="true">−</span>
          {removed} removed
        </span>
      )}
      {modified > 0 && (
        <span className="flex items-center gap-1 text-[var(--stgm-warning,#f59e0b)]">
          <span aria-hidden="true">~</span>
          {modified} modified
        </span>
      )}
    </div>
  );
});

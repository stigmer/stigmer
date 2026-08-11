"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { GraphDiff } from "./types.js";

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
          "stg:flex stg:items-center stg:gap-2 stg:rounded-md stg:border stg:border-[var(--stgm-border,#e5e5e5)] stg:bg-[var(--stgm-card,var(--stgm-background,#fff))] stg:px-3 stg:py-1.5 stg:text-xs stg:text-[var(--stgm-muted-foreground,#737373)] stg:shadow-sm",
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
        "stg:flex stg:items-center stg:gap-3 stg:rounded-md stg:border stg:border-[var(--stgm-border,#e5e5e5)] stg:bg-[var(--stgm-card,var(--stgm-background,#fff))] stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:shadow-sm",
        className,
      )}
      role="status"
      aria-label={`Diff summary: ${added} added, ${removed} removed, ${modified} modified`}
    >
      {added > 0 && (
        <span className="stg:flex stg:items-center stg:gap-1 stg:text-[var(--stgm-success,#22c55e)]">
          <span aria-hidden="true">+</span>
          {added} added
        </span>
      )}
      {removed > 0 && (
        <span className="stg:flex stg:items-center stg:gap-1 stg:text-[var(--stgm-destructive,#ef4444)]">
          <span aria-hidden="true">−</span>
          {removed} removed
        </span>
      )}
      {modified > 0 && (
        <span className="stg:flex stg:items-center stg:gap-1 stg:text-[var(--stgm-warning,#f59e0b)]">
          <span aria-hidden="true">~</span>
          {modified} modified
        </span>
      )}
    </div>
  );
});

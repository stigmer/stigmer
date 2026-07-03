"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { NodeDiffStatus } from "../diff/types.js";

export interface DiffBadgeProps {
  readonly status: NodeDiffStatus;
  /** Number of changed top-level config fields (shown for modified nodes). */
  readonly changedFieldCount?: number;
}

/**
 * Compact diff status badge rendered at the top-right corner of a workflow
 * node in diff mode. Uses text/icon differentiation beyond color alone
 * (WCAG 1.4.1 compliance).
 *
 * Mirrors the positioning and sizing pattern of {@link ExecutionBadge}.
 */
export const DiffBadge = memo(function DiffBadge({
  status,
  changedFieldCount,
}: DiffBadgeProps) {
  if (status === "unchanged") return null;

  const { icon, label, className } = DIFF_BADGE_CONFIG[status];
  const displayText =
    status === "modified" && changedFieldCount != null && changedFieldCount > 0
      ? `~${changedFieldCount}`
      : icon;

  return (
    <span
      className={cn(
        "absolute -right-1.5 -top-1.5 z-20 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none shadow-sm",
        className,
      )}
      title={label}
      aria-label={label}
      data-diff-status={status}
    >
      {displayText}
    </span>
  );
});

interface DiffBadgeConfig {
  icon: string;
  label: string;
  className: string;
}

const DIFF_BADGE_CONFIG: Record<
  Exclude<NodeDiffStatus, "unchanged">,
  DiffBadgeConfig
> = {
  added: {
    icon: "+",
    label: "Added",
    className: "bg-[var(--stgm-success,#22c55e)] text-[var(--stgm-success-foreground,#fff)]",
  },
  removed: {
    icon: "−",
    label: "Removed",
    className: "bg-[var(--stgm-destructive,#ef4444)] text-[var(--stgm-destructive-foreground,#fff)]",
  },
  modified: {
    icon: "~",
    label: "Modified",
    className: "bg-[var(--stgm-warning,#f59e0b)] text-[var(--stgm-warning-foreground,#fff)]",
  },
};

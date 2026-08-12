"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { NodeDiffStatus } from "../diff/types.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../internal/tooltip.js";

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
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "stg:absolute stg:-right-1.5 stg:-top-1.5 stg:z-20 stg:flex stg:h-5 stg:min-w-5 stg:items-center stg:justify-center stg:rounded-full stg:px-1 stg:text-[10px] stg:font-semibold stg:leading-none stg:shadow-sm",
              className,
            )}
            aria-label={label}
            data-diff-status={status}
          />
        }
      >
        {displayText}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
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
    className: "stg:bg-[var(--stgm-success,#22c55e)] stg:text-[var(--stgm-success-foreground,#fff)]",
  },
  removed: {
    icon: "−",
    label: "Removed",
    className: "stg:bg-[var(--stgm-destructive,#ef4444)] stg:text-[var(--stgm-destructive-foreground,#fff)]",
  },
  modified: {
    icon: "~",
    label: "Modified",
    className: "stg:bg-[var(--stgm-warning,#f59e0b)] stg:text-[var(--stgm-warning-foreground,#fff)]",
  },
};

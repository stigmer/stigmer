"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { useCopyFeedback } from "../internal/useCopyFeedback.js";

/** Props for {@link WorkflowVersionBadge}. */
export interface WorkflowVersionBadgeProps {
  /** The SHA-256 hash to display (truncated to first 8 chars). */
  readonly versionHash: string;
  /** Optional tag to show as a colored chip (e.g. "stable", "v1.0"). */
  readonly tag?: string;
  /** Shows a "current" indicator dot when true. */
  readonly isCurrent?: boolean;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Compact badge showing a truncated version hash with optional tag
 * and "current" indicator.
 *
 * Designed for inline use in timelines, cards, and headers. Click-to-copy
 * copies the full hash to the clipboard and shows brief visual feedback.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 * Zero Console dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * <WorkflowVersionBadge
 *   versionHash="a1b2c3d4e5f67890abcdef1234567890"
 *   tag="stable"
 *   isCurrent
 * />
 * ```
 */
export const WorkflowVersionBadge = memo(function WorkflowVersionBadge({
  versionHash,
  tag,
  isCurrent,
  className,
}: WorkflowVersionBadgeProps) {
  const { copy, copied } = useCopyFeedback();
  const truncated = versionHash.slice(0, 8);

  return (
    <span className={cn("stg:inline-flex stg:items-center stg:gap-1.5", className)}>
      {isCurrent && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className="stg:size-2 stg:shrink-0 stg:rounded-full stg:bg-status-ready"
                aria-label="Current version"
              />
            }
          />
          <TooltipContent side="top">Current version</TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => void copy(versionHash)}
              className={cn(
                "stg:shrink-0 stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:font-mono stg:text-[11px] stg:font-medium stg:text-foreground stg:transition-colors",
                "stg:hover:bg-accent-hover",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                copied && "stg:bg-status-ready-subtle stg:text-status-ready",
              )}
            />
          }
        >
          {copied ? "copied" : truncated}
        </TooltipTrigger>
        <TooltipContent side="top" className="stg:break-all">
          {copied ? "Copied!" : `Copy full hash: ${versionHash}`}
        </TooltipContent>
      </Tooltip>

      {tag && (
        <span className="stg:shrink-0 stg:rounded-full stg:bg-primary-subtle stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-primary">
          {tag}
        </span>
      )}
    </span>
  );
});

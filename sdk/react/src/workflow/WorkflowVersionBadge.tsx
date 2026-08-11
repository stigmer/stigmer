"use client";

import { memo, useCallback, useState } from "react";
import { cn } from "@stigmer/theme";

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
  const [copied, setCopied] = useState(false);
  const truncated = versionHash.slice(0, 8);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(versionHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may be unavailable in some contexts
    }
  }, [versionHash]);

  return (
    <span className={cn("stg:inline-flex stg:items-center stg:gap-1.5", className)}>
      {isCurrent && (
        <span
          className="stg:size-2 stg:shrink-0 stg:rounded-full stg:bg-status-ready"
          aria-label="Current version"
          title="Current version"
        />
      )}

      <button
        type="button"
        onClick={handleCopy}
        title={copied ? "Copied!" : `Copy full hash: ${versionHash}`}
        className={cn(
          "stg:shrink-0 stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:font-mono stg:text-[11px] stg:font-medium stg:text-foreground stg:transition-colors",
          "stg:hover:bg-accent-hover",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          copied && "stg:bg-status-ready-subtle stg:text-status-ready",
        )}
      >
        {copied ? "copied" : truncated}
      </button>

      {tag && (
        <span className="stg:shrink-0 stg:rounded-full stg:bg-primary-subtle stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-primary">
          {tag}
        </span>
      )}
    </span>
  );
});

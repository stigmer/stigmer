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
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {isCurrent && (
        <span
          className="size-2 shrink-0 rounded-full bg-status-ready"
          aria-label="Current version"
          title="Current version"
        />
      )}

      <button
        type="button"
        onClick={handleCopy}
        title={copied ? "Copied!" : `Copy full hash: ${versionHash}`}
        className={cn(
          "shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground transition-colors",
          "hover:bg-accent-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          copied && "bg-status-ready-subtle text-status-ready",
        )}
      >
        {copied ? "copied" : truncated}
      </button>

      {tag && (
        <span className="shrink-0 rounded-full bg-primary-subtle px-1.5 py-0.5 text-[10px] font-medium text-primary">
          {tag}
        </span>
      )}
    </span>
  );
});

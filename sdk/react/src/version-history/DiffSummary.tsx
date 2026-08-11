"use client";

import { cn } from "@stigmer/theme";

/** Props for {@link DiffSummary}. */
export interface DiffSummaryProps {
  /** Number of files with changes. */
  readonly fileCount: number;
  /** Total added lines across all files. */
  readonly additions: number;
  /** Total removed lines across all files. */
  readonly deletions: number;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Summary bar showing aggregate diff statistics.
 *
 * Renders "N files changed, +X additions, -Y deletions" in a compact
 * single-line format. Uses diff-specific design tokens for coloring.
 *
 * Zero Console dependencies — safe for platform builder embedding.
 */
export function DiffSummary({
  fileCount,
  additions,
  deletions,
  className,
}: DiffSummaryProps) {
  const fileLabel = fileCount === 1 ? "1 file changed" : `${fileCount} files changed`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "stg:flex stg:items-center stg:gap-2 stg:text-xs stg:text-muted-foreground",
        className,
      )}
    >
      <span>{fileLabel}</span>
      {additions > 0 && (
        <>
          <span aria-hidden="true">&middot;</span>
          <span className="stg:font-mono stg:text-diff-added-fg">
            +{additions} {additions === 1 ? "addition" : "additions"}
          </span>
        </>
      )}
      {deletions > 0 && (
        <>
          <span aria-hidden="true">&middot;</span>
          <span className="stg:font-mono stg:text-diff-removed-fg">
            -{deletions} {deletions === 1 ? "deletion" : "deletions"}
          </span>
        </>
      )}
    </div>
  );
}

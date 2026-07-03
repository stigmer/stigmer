"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import type { MultiFileDiffResult } from "./types.js";
import { DiffViewer } from "./DiffViewer.js";
import { DiffFileList } from "./DiffFileList.js";
import { DiffSummary } from "./DiffSummary.js";

/** Props for {@link MultiFileDiffView}. */
export interface MultiFileDiffViewProps {
  /** Multi-file diff result from `computeMultiFileDiff()`. */
  readonly diff: MultiFileDiffResult;
  /**
   * Initially selected file path. When omitted, defaults to the first
   * changed file (SKILL.md if present, per the sort order).
   */
  readonly initialSelectedPath?: string;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Composed multi-file diff view with file list and per-file unified diff.
 *
 * Layout: summary bar at top, file list as a horizontal scrollable bar,
 * and the full unified diff for the selected file below. Designed to
 * work within a dialog or a detail page panel.
 *
 * Zero Console dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * const diff = computeMultiFileDiff(oldFiles, newFiles);
 * <MultiFileDiffView diff={diff} />
 * ```
 */
export function MultiFileDiffView({
  diff,
  initialSelectedPath,
  className,
}: MultiFileDiffViewProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(
    initialSelectedPath ?? diff.files[0]?.path ?? null,
  );

  const handleSelect = useCallback((path: string) => {
    setSelectedPath(path);
  }, []);

  const hunks = selectedPath ? diff.getDiff(selectedPath) : [];

  if (diff.files.length === 0) {
    return (
      <div
        role="status"
        className={cn(
          "flex flex-col items-center gap-2 py-12 text-center",
          className,
        )}
      >
        <NoDiffIcon className="size-8 text-muted-foreground-faint" />
        <p className="text-sm text-muted-foreground">No differences found</p>
        <p className="text-xs text-muted-foreground-subtle">
          These two versions have identical content.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <DiffSummary
        fileCount={diff.files.length}
        additions={diff.totalAdditions}
        deletions={diff.totalDeletions}
      />

      {diff.files.length > 1 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <DiffFileList
            files={diff.files}
            selectedPath={selectedPath}
            onSelect={handleSelect}
          />
        </div>
      )}

      <DiffViewer hunks={hunks} filePath={selectedPath ?? undefined} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function NoDiffIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 3v10M3 8h10" />
      <circle cx="8" cy="8" r="7" />
    </svg>
  );
}

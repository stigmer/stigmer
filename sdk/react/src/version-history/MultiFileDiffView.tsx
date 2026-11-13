"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import { EmptyState } from "../empty-state/EmptyState.js";
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
 * // Each map is a version's files, by path.
 * function VersionDiff({ before, after }: { before: ReadonlyMap<string, string>; after: ReadonlyMap<string, string> }) {
 *   const diff = useMemo(() => computeMultiFileDiff(before, after), [before, after]);
 *   return <MultiFileDiffView diff={diff} />;
 * }
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
      <EmptyState
        variant="first-use"
        icon={<NoDiffIcon />}
        title="No differences found"
        description="These two versions have identical content."
        className={className}
      />
    );
  }

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-3", className)}>
      <DiffSummary
        fileCount={diff.files.length}
        additions={diff.totalAdditions}
        deletions={diff.totalDeletions}
      />

      {diff.files.length > 1 && (
        <div className="stg:overflow-hidden stg:rounded-lg stg:border stg:border-border">
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

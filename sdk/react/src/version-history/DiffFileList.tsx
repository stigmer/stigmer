"use client";

import { cn } from "@stigmer/theme";
import type { FileDiffEntry } from "./types.js";

/** Props for {@link DiffFileList}. */
export interface DiffFileListProps {
  /** Changed files to display. */
  readonly files: readonly FileDiffEntry[];
  /** Currently selected file path. */
  readonly selectedPath: string | null;
  /** Called when a file is clicked. */
  readonly onSelect: (path: string) => void;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * File list with change-type indicators for a multi-file diff.
 *
 * Each file shows its path, change type badge (M/A/D), and a compact
 * `+N -N` additions/deletions count. Files are keyboard-navigable.
 *
 * Zero Console dependencies — safe for platform builder embedding.
 */
export function DiffFileList({
  files,
  selectedPath,
  onSelect,
  className,
}: DiffFileListProps) {
  if (files.length === 0) return null;

  return (
    <nav
      aria-label="Changed files"
      className={cn("stg:flex stg:flex-col stg:overflow-auto", className)}
    >
      {files.map((file) => (
        <button
          key={file.path}
          type="button"
          onClick={() => onSelect(file.path)}
          aria-current={file.path === selectedPath ? "true" : undefined}
          className={cn(
            "stg:flex stg:items-center stg:gap-2 stg:px-3 stg:py-1.5 stg:text-left stg:text-xs stg:transition-colors",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:focus-visible:ring-inset",
            file.path === selectedPath
              ? "stg:bg-accent-hover stg:text-foreground"
              : "stg:text-muted-foreground stg:hover:bg-accent-hover stg:hover:text-foreground",
          )}
        >
          <ChangeTypeBadge changeType={file.changeType} />
          <span className="stg:min-w-0 stg:flex-1 stg:truncate stg:font-mono">{file.path}</span>
          <DeltaCount additions={file.additions} deletions={file.deletions} />
        </button>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Change type badge (M / A / D)
// ---------------------------------------------------------------------------

function ChangeTypeBadge({
  changeType,
}: {
  readonly changeType: FileDiffEntry["changeType"];
}) {
  const letter = changeType === "modified" ? "M" : changeType === "added" ? "A" : "D";
  const color =
    changeType === "modified"
      ? "stg:text-diff-hunk-header-fg"
      : changeType === "added"
        ? "stg:text-diff-added-fg"
        : "stg:text-diff-removed-fg";

  return (
    <span
      className={cn("stg:shrink-0 stg:font-mono stg:text-[10px] stg:font-bold", color)}
      aria-label={changeType}
    >
      {letter}
    </span>
  );
}

// ---------------------------------------------------------------------------
// +N -N delta count
// ---------------------------------------------------------------------------

function DeltaCount({
  additions,
  deletions,
}: {
  readonly additions: number;
  readonly deletions: number;
}) {
  return (
    <span className="stg:shrink-0 stg:font-mono stg:text-[10px]">
      {additions > 0 && (
        <span className="stg:text-diff-added-fg">+{additions}</span>
      )}
      {additions > 0 && deletions > 0 && " "}
      {deletions > 0 && (
        <span className="stg:text-diff-removed-fg">-{deletions}</span>
      )}
    </span>
  );
}

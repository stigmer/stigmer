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
      className={cn("flex flex-col overflow-auto", className)}
    >
      {files.map((file) => (
        <button
          key={file.path}
          type="button"
          onClick={() => onSelect(file.path)}
          aria-current={file.path === selectedPath ? "true" : undefined}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            file.path === selectedPath
              ? "bg-accent-hover text-foreground"
              : "text-muted-foreground hover:bg-accent-hover hover:text-foreground",
          )}
        >
          <ChangeTypeBadge changeType={file.changeType} />
          <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
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
      ? "text-diff-hunk-header-fg"
      : changeType === "added"
        ? "text-diff-added-fg"
        : "text-diff-removed-fg";

  return (
    <span
      className={cn("shrink-0 font-mono text-[10px] font-bold", color)}
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
    <span className="shrink-0 font-mono text-[10px]">
      {additions > 0 && (
        <span className="text-diff-added-fg">+{additions}</span>
      )}
      {additions > 0 && deletions > 0 && " "}
      {deletions > 0 && (
        <span className="text-diff-removed-fg">-{deletions}</span>
      )}
    </span>
  );
}

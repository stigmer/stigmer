"use client";

import { cn } from "@stigmer/theme";
import type { DiffHunk, DiffLine } from "./types.js";

/** Props for {@link DiffViewer}. */
export interface DiffViewerProps {
  /** Hunks to render — output of `computeDiff()`. */
  readonly hunks: readonly DiffHunk[];
  /** File path displayed in the header. */
  readonly filePath?: string;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Generic unified diff renderer for a single file.
 *
 * Renders a unified diff with line numbers, `+`/`-` prefix indicators,
 * and hunk separator headers. Uses `--stgm-diff-*` design tokens for
 * all colors — respects light/dark mode and preset overrides.
 *
 * Accessibility: uses a `<table>` with proper column headers, `+`/`-`
 * text indicators alongside color (color is never the sole channel),
 * and ARIA labels on change lines for screen readers.
 *
 * Zero Console dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * const hunks = computeDiff(oldText, newText);
 * <DiffViewer hunks={hunks} filePath="SKILL.md" />
 * ```
 */
export function DiffViewer({ hunks, filePath, className }: DiffViewerProps) {
  if (hunks.length === 0) {
    return (
      <div
        role="status"
        className={cn(
          "stg:flex stg:items-center stg:justify-center stg:py-8 stg:text-sm stg:text-muted-foreground",
          className,
        )}
      >
        No changes
      </div>
    );
  }

  return (
    <div
      className={cn(
        "stg:overflow-auto stg:rounded-lg stg:border stg:border-border stg:font-mono stg:text-[13px] stg:leading-[1.6]",
        className,
      )}
    >
      {filePath && (
        <div className="stg:sticky stg:top-0 stg:z-10 stg:border-b stg:border-border stg:bg-muted stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:text-muted-foreground">
          {filePath}
        </div>
      )}

      <table className="stg:w-full stg:border-collapse" role="table">
        <thead className="stg:sr-only">
          <tr>
            <th scope="col">Line</th>
            <th scope="col">Change</th>
            <th scope="col">Content</th>
          </tr>
        </thead>
        <tbody>
          {hunks.map((hunk, hunkIdx) => (
            <HunkRows key={hunkIdx} hunk={hunk} isFirst={hunkIdx === 0} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hunk rendering
// ---------------------------------------------------------------------------

function HunkRows({
  hunk,
  isFirst,
}: {
  readonly hunk: DiffHunk;
  readonly isFirst: boolean;
}) {
  const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;

  return (
    <>
      {!isFirst && (
        <tr>
          <td
            colSpan={3}
            className="stg:select-none stg:bg-diff-hunk-header-bg stg:px-3 stg:py-1 stg:text-[11px] stg:text-diff-hunk-header-fg"
            aria-label={`Hunk: ${header}`}
          >
            {header}
          </td>
        </tr>
      )}
      {hunk.lines.map((line, lineIdx) => (
        <DiffLineRow key={lineIdx} line={line} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Line rendering
// ---------------------------------------------------------------------------

const LINE_NUM_CLASSES =
  "stg:w-[1px] stg:min-w-10 stg:select-none stg:whitespace-nowrap stg:px-2 stg:text-right stg:text-[11px] stg:text-muted-foreground-faint";
const MARKER_CLASSES = "stg:w-[1px] stg:select-none stg:px-1 stg:text-center";

function DiffLineRow({ line }: { readonly line: DiffLine }) {
  const marker = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";

  const rowClass =
    line.type === "added"
      ? "stg:bg-diff-added-bg"
      : line.type === "removed"
        ? "stg:bg-diff-removed-bg"
        : "";

  const markerColor =
    line.type === "added"
      ? "stg:text-diff-added-fg"
      : line.type === "removed"
        ? "stg:text-diff-removed-fg"
        : "stg:text-muted-foreground-faint";

  const ariaLabel =
    line.type === "added"
      ? `Added line ${line.newLineNumber}: ${line.content}`
      : line.type === "removed"
        ? `Removed line ${line.oldLineNumber}: ${line.content}`
        : undefined;

  // A single line-number gutter — the Cursor/VS Code inline-diff convention,
  // more compact than GitHub's old+new pair. Each line shows the number from the
  // side it belongs to: the new-file number for added/context lines, the
  // old-file number for a removed line (which has no new-side number). The
  // marker (+/-) and row color carry the change type.
  const lineNumber = line.newLineNumber ?? line.oldLineNumber;

  return (
    <tr className={rowClass} aria-label={ariaLabel}>
      <td className={LINE_NUM_CLASSES}>
        {lineNumber ?? ""}
      </td>
      <td className={cn(MARKER_CLASSES, markerColor)} aria-hidden="true">
        {marker}
      </td>
      <td className="stg:whitespace-pre-wrap stg:break-all stg:px-2">
        {line.content}
      </td>
    </tr>
  );
}

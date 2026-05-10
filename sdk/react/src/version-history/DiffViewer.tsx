"use client";

import { cn } from "@stigmer/theme";
import type { DiffHunk, DiffLine } from "./types";

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
          "flex items-center justify-center py-8 text-sm text-muted-foreground",
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
        "overflow-auto rounded-lg border border-border font-mono text-[13px] leading-[1.6]",
        className,
      )}
    >
      {filePath && (
        <div className="sticky top-0 z-10 border-b border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
          {filePath}
        </div>
      )}

      <table className="w-full border-collapse" role="table">
        <thead className="sr-only">
          <tr>
            <th scope="col">Old line</th>
            <th scope="col">New line</th>
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
            colSpan={4}
            className="select-none bg-diff-hunk-header-bg px-3 py-1 text-[11px] text-diff-hunk-header-fg"
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
  "w-[1px] min-w-10 select-none whitespace-nowrap px-2 text-right text-[11px] text-muted-foreground-faint";
const MARKER_CLASSES = "w-[1px] select-none px-1 text-center";

function DiffLineRow({ line }: { readonly line: DiffLine }) {
  const marker = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";

  const rowClass =
    line.type === "added"
      ? "bg-diff-added-bg"
      : line.type === "removed"
        ? "bg-diff-removed-bg"
        : "";

  const markerColor =
    line.type === "added"
      ? "text-diff-added-fg"
      : line.type === "removed"
        ? "text-diff-removed-fg"
        : "text-muted-foreground-faint";

  const ariaLabel =
    line.type === "added"
      ? `Added line ${line.newLineNumber}: ${line.content}`
      : line.type === "removed"
        ? `Removed line ${line.oldLineNumber}: ${line.content}`
        : undefined;

  return (
    <tr className={rowClass} aria-label={ariaLabel}>
      <td className={LINE_NUM_CLASSES}>
        {line.oldLineNumber ?? ""}
      </td>
      <td className={LINE_NUM_CLASSES}>
        {line.newLineNumber ?? ""}
      </td>
      <td className={cn(MARKER_CLASSES, markerColor)} aria-hidden="true">
        {marker}
      </td>
      <td className="whitespace-pre-wrap break-all px-2">
        {line.content}
      </td>
    </tr>
  );
}

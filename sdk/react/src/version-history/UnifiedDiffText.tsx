"use client";

import { cn } from "@stigmer/theme";

/** Props for {@link UnifiedDiffText}. */
export interface UnifiedDiffTextProps {
  /** A unified-diff patch string (e.g. Cursor's hunk-only `diffString`). */
  readonly patch: string;
  /** Additional CSS classes for the root `<pre>` (e.g. a height cap). */
  readonly className?: string;
}

/**
 * Renders a raw unified-diff patch string with `+`/`-`/`@@` coloring.
 *
 * This is the single canonical renderer for hunk-only patches (the Cursor
 * harness's `diffString`), shared by every diff surface — the post-execution
 * {@link ResultView}, the per-file {@link FileChangeDiff}, and the approval
 * gate. It uses the `--stgm-diff-*` design tokens (never `text-success` /
 * `text-destructive`), so the coloring matches {@link DiffViewer} exactly and
 * respects light/dark mode and preset overrides.
 *
 * Color is never the sole channel: the literal `+`/`-` characters from the
 * patch carry the change type for non-color readers.
 */
export function UnifiedDiffText({ patch, className }: UnifiedDiffTextProps) {
  const lines = patch.split("\n");
  return (
    <pre
      className={cn(
        "max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted-subtle p-2 font-mono text-xs",
        className,
      )}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            line.startsWith("+") && !line.startsWith("+++") && "text-diff-added-fg",
            line.startsWith("-") && !line.startsWith("---") && "text-diff-removed-fg",
            line.startsWith("@@") && "text-diff-hunk-header-fg",
          )}
        >
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

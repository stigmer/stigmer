"use client";

import { useMemo } from "react";
import { cn } from "@stigmer/theme";
import { DiffViewer } from "./DiffViewer.js";
import { parseUnifiedDiff } from "./parseUnifiedDiff.js";

/** Props for {@link UnifiedDiffView}. */
export interface UnifiedDiffViewProps {
  /** A unified-diff patch string (e.g. Cursor's hunk-only `diffString`). */
  readonly patch: string;
  /** Additional CSS classes for the root container (e.g. a height cap). */
  readonly className?: string;
}

/**
 * The single canonical renderer for a unified-diff patch *string*.
 *
 * It parses the patch into hunks and renders them through {@link DiffViewer} —
 * the same accessible table (line numbers, colored row backgrounds, a narrow
 * `+`/`-` gutter column, `--stgm-diff-*` tokens) that a computed before/after
 * diff uses — so a harness that only emits a ready unified diff (the Cursor
 * harness's `diffString`) looks line-for-line identical to a native whole-file
 * diff. The `---`/`+++`/`@@` preamble parses into metadata and never reaches the
 * screen; a single-hunk diff shows no `@@` separator at all.
 *
 * Fallback: if the patch cannot be parsed into any hunk (a malformed or
 * non-standard payload) it renders verbatim in a `<pre>` so we show something
 * truthful rather than a misleading "No changes". Color is never the sole
 * channel in either path — the gutter marker / literal prefix carries the change
 * type for non-color readers.
 *
 * Internal to the SDK (not barrel-exported); consumed by {@link ResultView} and
 * {@link FileChangeDiff}.
 */
export function UnifiedDiffView({ patch, className }: UnifiedDiffViewProps) {
  const hunks = useMemo(() => parseUnifiedDiff(patch), [patch]);

  if (hunks.length > 0) {
    return <DiffViewer hunks={hunks} className={className} />;
  }

  // Unparseable but non-empty: show the raw patch rather than nothing.
  const lines = patch.split("\n");
  return (
    <pre
      className={cn(
        "stg:max-h-96 stg:overflow-auto stg:whitespace-pre-wrap stg:break-words stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:p-2 stg:font-mono stg:text-xs",
        className,
      )}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            line.startsWith("+") && !line.startsWith("+++") && "stg:text-diff-added-fg",
            line.startsWith("-") && !line.startsWith("---") && "stg:text-diff-removed-fg",
            line.startsWith("@@") && "stg:text-diff-hunk-header-fg",
          )}
        >
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

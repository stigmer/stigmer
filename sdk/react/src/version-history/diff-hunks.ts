import type { StructuredPatchHunk } from "diff";
import type { DiffHunk, DiffLine } from "./types";

/**
 * Maps the `diff` library's structured-patch hunks into our presentation
 * {@link DiffHunk} shape, assigning running old/new line numbers per line.
 *
 * This is the single source of truth for the hunk mapping, shared by
 * {@link computeDiff} (which feeds it `structuredPatch` output computed from
 * before/after text) and `parseUnifiedDiff` (which feeds it `parsePatch` output
 * parsed from a unified-diff string). Both functions in the `diff` library emit
 * the identical {@link StructuredPatchHunk} shape, so one mapper serves both and
 * the two diff sources can never drift in how a `+`/`-`/context line becomes a
 * {@link DiffLine}.
 *
 * `\ No newline at end of file` markers are skipped: they are diff metadata, not
 * content, and would otherwise be mis-rendered as a spurious context line.
 *
 * Pure function — no side effects, safe to call outside React.
 */
export function mapPatchHunks(
  hunks: readonly StructuredPatchHunk[],
): readonly DiffHunk[] {
  return hunks.map((hunk) => {
    const lines: DiffLine[] = [];
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;

    for (const raw of hunk.lines) {
      // "\ No newline at end of file" is a metadata marker, not a real line.
      if (raw.startsWith("\\")) continue;

      const prefix = raw[0];
      const content = raw.slice(1);

      if (prefix === "+") {
        lines.push({ type: "added", content, newLineNumber: newLine });
        newLine++;
      } else if (prefix === "-") {
        lines.push({ type: "removed", content, oldLineNumber: oldLine });
        oldLine++;
      } else {
        // A context line (leading space) or an empty raw line.
        lines.push({
          type: "context",
          content,
          oldLineNumber: oldLine,
          newLineNumber: newLine,
        });
        oldLine++;
        newLine++;
      }
    }

    return {
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      lines,
    };
  });
}

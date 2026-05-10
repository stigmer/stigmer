import { structuredPatch } from "diff";
import type { DiffHunk, DiffLine } from "./types";

/**
 * Compute a unified diff between two text strings.
 *
 * Returns an array of {@link DiffHunk} objects, each containing the
 * changed and context lines with line numbers. Uses the `diff` library's
 * Myers algorithm internally.
 *
 * Pure function — no side effects, safe to call outside React.
 *
 * @param oldText - The "before" text content.
 * @param newText - The "after" text content.
 * @param contextLines - Number of unchanged context lines around changes (default: 3).
 */
export function computeDiff(
  oldText: string,
  newText: string,
  contextLines = 3,
): readonly DiffHunk[] {
  const patch = structuredPatch("a", "b", oldText, newText, "", "", {
    context: contextLines,
  });

  return patch.hunks.map((hunk) => {
    const lines: DiffLine[] = [];
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;

    for (const raw of hunk.lines) {
      const prefix = raw[0];
      const content = raw.slice(1);

      if (prefix === "+") {
        lines.push({ type: "added", content, newLineNumber: newLine });
        newLine++;
      } else if (prefix === "-") {
        lines.push({ type: "removed", content, oldLineNumber: oldLine });
        oldLine++;
      } else {
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

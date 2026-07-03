import { structuredPatch } from "diff";
import { mapPatchHunks } from "./diff-hunks.js";
import type { DiffHunk } from "./types.js";

/**
 * Compute a unified diff between two text strings.
 *
 * Returns an array of {@link DiffHunk} objects, each containing the
 * changed and context lines with line numbers. Uses the `diff` library's
 * Myers algorithm internally, then maps the structured hunks through the
 * shared {@link mapPatchHunks} (the same mapper `parseUnifiedDiff` uses), so a
 * computed diff and a parsed unified diff render line-for-line identically.
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

  return mapPatchHunks(patch.hunks);
}

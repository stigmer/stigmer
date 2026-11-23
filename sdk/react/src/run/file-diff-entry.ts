// A file change as a file list draws it: the DisplayFileChange → FileDiffEntry
// projection the kit's file lists read (`FileChangesView`, `DiffFileList`),
// with counts taken from the change's own content where it is inline.
// Domain: run. The net change itself is derived in @stigmer/react-core
// (`deriveRunFileChanges`); this projection stays in the kit because it
// speaks the kit's version-history types.

import type { DisplayFileChange } from "@stigmer/client";
import { computeDiff } from "@stigmer/react-core";
import type { DiffHunk, FileDiffEntry } from "../version-history/types.js";

/**
 * Projects a {@link DisplayFileChange} into a {@link FileDiffEntry} for a file
 * list (`DiffFileList`).
 *
 * Counts: inline content is derived from the content (identical to the runner's capture-time counts by
 * construction — same diff algorithm). A whole-file side with no synchronous
 * content (offloaded / binary) falls back to the runner's capture-time
 * `linesAdded`/`linesRemoved` — zero when no count exists, which the list
 * renders as no stat.
 */
export function toFileDiffEntry(change: DisplayFileChange): FileDiffEntry {
  const changeType =
    change.changeType === "added"
      ? "added"
      : change.changeType === "deleted"
        ? "removed"
        : "modified";

  const before = inlineSide(change.before);
  const after = inlineSide(change.after);
  if (before !== null && after !== null) {
    const { additions, deletions } = countHunks(computeDiff(before, after));
    return { path: change.path, changeType, additions, deletions };
  }

  return {
    path: change.path,
    changeType,
    additions: change.linesAdded,
    deletions: change.linesRemoved,
  };
}

/** Sums added/removed line counts across rendered diff hunks. */
export function countHunks(hunks: readonly DiffHunk[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === "added") additions++;
      else if (line.type === "removed") deletions++;
    }
  }
  return { additions, deletions };
}

/** Inline text of a side, or null when absent/offloaded/binary. */
function inlineSide(side: DisplayFileChange["before"]): string | null {
  if (!side) return "";
  if (side.isBinary) return null;
  return side.body.case === "inline" ? side.body.value : null;
}

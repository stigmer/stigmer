// Pure derivation of net file changes across a chronological list of agent
// runs, plus the DisplayFileChange → FileDiffEntry projection for file lists.
// Domain: run (the session's Changes surface collapses per-execution
// captures into one net change per path; the non-trivial net-diff semantics
// below live in this one core).
//
// Not a hook: callers memoize on their runs reference
// (`useSessionFileChanges`).

import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  displayFileChangeSets,
  toDisplayFileChange,
  type DisplayFileChange,
  type DisplayFileChangeType,
} from "@stigmer/sdk";
import { computeDiff } from "../version-history/computeDiff.js";
import type { DiffHunk, FileDiffEntry } from "../version-history/types.js";

/**
 * Collapses the file changes captured across `executions` into one *net*
 * {@link DisplayFileChange} per path, ordered for a file list (modified, then
 * added/renamed, then deleted; alphabetical within each group).
 *
 * **Source.** Each run's file record ({@link displayFileChangeSets}: the
 * change sets it captured, `RunStatus.file_changes`), each captured change
 * projected via {@link toDisplayFileChange}. A run's record already includes
 * sub-agent captures, so one pass per run suffices. What was decided about a
 * file is the session's events, not this list.
 *
 * **Net-diff (not latest-wins).** A change is a *delta*: an agent often
 * rewrites the same file several times, and showing only the last edit's diff
 * would misrepresent what changed. So changes to the same path are reduced to
 * a single net change: `before` from the first change, `after` from the last.
 * Every capture is a complete file snapshot, so `first.before -> last.after`
 * is exactly the net change. A group with one change (the common case) is
 * passed through untouched.
 *
 * **Ordering is a correctness input.** `executions` MUST be chronological:
 * the net collapse anchors on each path's first and last change, so two
 * runs touching the same path (a session's follow-up turns) produce a
 * wrong net diff if visited out of order.
 *
 * Counts for captures stay derivable by the presentation layer, matching
 * the contract the SDK `tool-view` established.
 */
export function deriveRunFileChanges(
  executions: readonly Run[],
): readonly DisplayFileChange[] {
  // Path -> chronological list of raw changes to that path.
  const groups = new Map<string, DisplayFileChange[]>();
  // Preserve first-seen path order as a stable tiebreaker before sorting.
  const collect = (change: DisplayFileChange) => {
    const key = change.path;
    if (!key) return;
    const list = groups.get(key);
    if (list) list.push(change);
    else groups.set(key, [change]);
  };

  for (const execution of executions) {
    for (const set of displayFileChangeSets(execution.status)) {
      for (const captured of set.changes) collect(toDisplayFileChange(captured));
    }
  }

  const fileChanges = Array.from(groups.values(), netChange);
  fileChanges.sort(fileChangeComparator);
  return fileChanges;
}

/**
 * Reduces a path's chronological change list to a single net change.
 * A one-change group is returned as-is (the common path, no allocation).
 */
function netChange(changes: DisplayFileChange[]): DisplayFileChange {
  if (changes.length === 1) return changes[0];

  const first = changes[0];
  const last = changes[changes.length - 1];
  const changeType = netChangeType(first, last);

  return {
    path: last.path,
    changeType,
    before: first.before,
    after: last.after,
    // Counts belong to one capture; the net diff's are derived from its sides.
    linesAdded: 0,
    linesRemoved: 0,
    renameFrom: changeType === "renamed" ? first.renameFrom : "",
  };
}

/**
 * Reconciles the net change of a path from its first and last change.
 *
 * Intent: the badge should describe the file's journey across the *whole*
 * span of runs, anchored on its two endpoints, in this precedence:
 *
 * 1. Ends deleted (`last` is deleted) -> deleted. The file is gone, regardless
 *    of how it got there; this includes add-then-delete, which we deliberately
 *    surface as deleted rather than hiding the path. (`before` then comes from
 *    the first change, which for an added-then-deleted file is empty, so the
 *    diff reads as the removal of whatever briefly existed.)
 * 2. Started added (`first` is added) and still exists -> added. A file born
 *    in this span and later modified is, on net, a new file.
 * 3. Started renamed (`first` is renamed) and still exists -> renamed,
 *    carrying the original `renameFrom` so the move is preserved across later
 *    edits.
 * 4. Otherwise -> modified (the common multi-edit case).
 */
function netChangeType(
  first: DisplayFileChange,
  last: DisplayFileChange,
): DisplayFileChangeType {
  if (last.changeType === "deleted") return "deleted";
  if (first.changeType === "added") return "added";
  if (first.changeType === "renamed") return "renamed";
  return "modified";
}

// Most-actionable first (modified), then additions (added/renamed), then
// deletions, mirroring GitHub's file-list convention; alphabetical within
// each group so the list is stable and scannable.
const CHANGE_TYPE_ORDER: Readonly<Record<DisplayFileChangeType, number>> = {
  modified: 0,
  added: 1,
  renamed: 1,
  deleted: 2,
};

function fileChangeComparator(a: DisplayFileChange, b: DisplayFileChange): number {
  const order = CHANGE_TYPE_ORDER[a.changeType] - CHANGE_TYPE_ORDER[b.changeType];
  if (order !== 0) return order;
  return a.path.localeCompare(b.path, undefined, { sensitivity: "base" });
}

// ---------------------------------------------------------------------------
// DisplayFileChange → FileDiffEntry projection (file lists)
// ---------------------------------------------------------------------------

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

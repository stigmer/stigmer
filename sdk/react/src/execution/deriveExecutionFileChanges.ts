// Pure derivation of net file changes across a chronological list of agent
// executions, plus the FileChange → FileDiffEntry projection for file lists.
// Domain: execution (shared — the session's Changes surface and the workflow
// panel's Changes facet both collapse per-execution captures into one net
// change per path, and a single core prevents the two from drifting on the
// non-trivial net-diff semantics below).
//
// Not a hook: callers memoize on their executions reference
// (`useSessionFileChanges` for sessions; `useWorkflowExecutionFileChanges`
// aggregates a workflow's AGENT_CALL children).

import { create } from "@bufbuild/protobuf";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { FileChangeSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  FileChangeCaptureLevel,
  FileChangeType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { displayFileChangeSets, toDisplayFileChange } from "@stigmer/sdk";
import { computeDiff } from "../version-history/computeDiff.js";
import type { DiffHunk, FileDiffEntry } from "../version-history/types.js";

/**
 * Collapses the file changes captured across `executions` into one *net*
 * {@link FileChange} per path, ordered for a file list (modified, then
 * created/renamed, then deleted; alphabetical within each group).
 *
 * **Source (ledger-first).** Under apply-then-review the changes live in the
 * file-review ledger; {@link displayFileChangeSets} reads the server's live
 * projection or folds the durable ledger for a terminal execution (whose
 * projection is nil), and each captured change is projected onto the display
 * {@link FileChange} via {@link toDisplayFileChange}. The execution-scoped
 * ledger already includes sub-agent captures (DD-19), so one pass per
 * execution suffices.
 *
 * **Net-diff (not latest-wins).** A {@link FileChange} is a *delta* — an
 * agent often rewrites the same file several times, and showing only the last
 * edit's diff would misrepresent what changed. So changes to the same path
 * are reduced to a single net change: `before` from the first change, `after`
 * from the last. Because a WHOLE_FILE `after` is a complete file snapshot,
 * `first.before → last.after` is exactly the net change. A group with one
 * change (the common case) is passed through untouched; multi-edit groups
 * synthesize a net {@link FileChange} so every consumer speaks one proto
 * type (DD-007).
 *
 * **Ordering is a correctness input.** `executions` MUST be chronological:
 * the net collapse anchors on each path's first and last change, so two
 * executions touching the same path (a session's follow-up turns; two
 * workflow agent-call tasks) produce a wrong net diff if visited out of
 * order.
 *
 * Counts and unified diffs for whole-file captures stay derivable by the
 * presentation layer (the runner emits 0/"" sentinels), matching the
 * contract the SDK `tool-view` established.
 */
export function deriveExecutionFileChanges(
  executions: readonly AgentExecution[],
): readonly FileChange[] {
  // Path -> chronological list of raw changes to that path.
  const groups = new Map<string, FileChange[]>();
  // Preserve first-seen path order as a stable tiebreaker before sorting.
  const collect = (change: FileChange) => {
    const key = change.path || change.absolutePath;
    if (!key) return;
    const list = groups.get(key);
    if (list) list.push(change);
    else groups.set(key, [change]);
  };

  for (const execution of executions) {
    const capturedChanges = displayFileChangeSets(execution.status).flatMap(
      (set) => set.changes,
    );
    for (const captured of capturedChanges) collect(toDisplayFileChange(captured));
  }

  const fileChanges = Array.from(groups.values(), netChange);
  fileChanges.sort(fileChangeComparator);
  return fileChanges;
}

/**
 * Reduces a path's chronological change list to a single net change.
 * A one-change group is returned as-is (the common path, no allocation);
 * multi-edit groups synthesize a net {@link FileChange}.
 */
function netChange(changes: FileChange[]): FileChange {
  if (changes.length === 1) return changes[0];

  const first = changes[0];
  const last = changes[changes.length - 1];
  const changeType = netChangeType(first, last);

  // Whole-file only when both chosen sides come from whole-file captures;
  // otherwise fall back to the last change's hunk diff. A path edited by a
  // single harness won't mix levels — this just stays honest if it ever does.
  const wholeFile =
    first.captureLevel === FileChangeCaptureLevel.WHOLE_FILE &&
    last.captureLevel === FileChangeCaptureLevel.WHOLE_FILE;

  if (wholeFile) {
    return create(FileChangeSchema, {
      path: last.path,
      absolutePath: last.absolutePath,
      changeType,
      captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
      before: first.before,
      after: last.after,
      renameFrom: changeType === FileChangeType.RENAME ? first.renameFrom : "",
    });
  }

  return create(FileChangeSchema, {
    path: last.path,
    absolutePath: last.absolutePath,
    changeType,
    captureLevel: FileChangeCaptureLevel.HUNK_ONLY,
    unifiedDiff: last.unifiedDiff,
    linesAdded: last.linesAdded,
    linesRemoved: last.linesRemoved,
    renameFrom: changeType === FileChangeType.RENAME ? first.renameFrom : "",
  });
}

/**
 * Reconciles the net `change_type` of a path from its first and last change.
 *
 * Intent: the badge should describe the file's journey across the *whole*
 * span of executions, anchored on its two endpoints, in this precedence:
 *
 * 1. Ends deleted (`last` is DELETE) → DELETE. The file is gone, regardless of
 *    how it got there — this includes create-then-delete, which we deliberately
 *    surface as DELETE rather than hiding the path. (`before` then comes from
 *    the first change, which for a created-then-deleted file is empty, so the
 *    diff reads as the removal of whatever briefly existed.)
 * 2. Started created (`first` is CREATE) and still exists → CREATE. A file born
 *    in this span and later modified is, on net, a new file.
 * 3. Started renamed (`first` is RENAME) and still exists → RENAME, carrying the
 *    original `rename_from` so the move is preserved across later edits.
 * 4. Otherwise → MODIFY (the common multi-edit case).
 */
function netChangeType(first: FileChange, last: FileChange): FileChangeType {
  if (last.changeType === FileChangeType.DELETE) return FileChangeType.DELETE;
  if (first.changeType === FileChangeType.CREATE) return FileChangeType.CREATE;
  if (first.changeType === FileChangeType.RENAME) return FileChangeType.RENAME;
  return FileChangeType.MODIFY;
}

// Most-actionable first (modified), then additions (create/rename), then
// deletions — mirroring GitHub's file-list convention — alphabetical within
// each group so the list is stable and scannable.
const CHANGE_TYPE_ORDER: Readonly<Record<FileChangeType, number>> = {
  [FileChangeType.MODIFY]: 0,
  [FileChangeType.CREATE]: 1,
  [FileChangeType.RENAME]: 1,
  [FileChangeType.DELETE]: 2,
  [FileChangeType.UNSPECIFIED]: 3,
};

function fileChangeComparator(a: FileChange, b: FileChange): number {
  const order =
    (CHANGE_TYPE_ORDER[a.changeType] ?? 3) -
    (CHANGE_TYPE_ORDER[b.changeType] ?? 3);
  if (order !== 0) return order;
  return a.path.localeCompare(b.path, undefined, { sensitivity: "base" });
}

// ---------------------------------------------------------------------------
// FileChange → FileDiffEntry projection (file lists)
// ---------------------------------------------------------------------------

/**
 * Projects a {@link FileChange} into a {@link FileDiffEntry} for a file list
 * (`DiffFileList`).
 *
 * Counts: hunk-only uses the runner's authoritative numbers; whole-file inline
 * is derived from the content (identical to the runner's capture-time counts by
 * construction — same diff algorithm). A whole-file side with no synchronous
 * content (offloaded / binary) falls back to the runner's capture-time
 * `linesAdded`/`linesRemoved` — zero when no count exists, which the list
 * renders as no stat.
 */
export function toFileDiffEntry(change: FileChange): FileDiffEntry {
  const changeType =
    change.changeType === FileChangeType.CREATE
      ? "added"
      : change.changeType === FileChangeType.DELETE
        ? "removed"
        : "modified";

  if (change.captureLevel === FileChangeCaptureLevel.HUNK_ONLY) {
    return {
      path: change.path,
      changeType,
      additions: change.linesAdded,
      deletions: change.linesRemoved,
    };
  }

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
function inlineSide(side: FileChange["before"]): string | null {
  if (!side) return "";
  if (side.isBinary) return null;
  return side.body.case === "inline" ? side.body.value : null;
}

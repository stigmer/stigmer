"use client";

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { FileChangeSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  FileChangeCaptureLevel,
  FileChangeType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { displayFileChangeSets, toDisplayFileChange } from "@stigmer/sdk";

/** Return value of {@link useSessionFileChanges}. */
export interface UseSessionFileChangesReturn {
  /**
   * One {@link FileChange} per file touched in the session — the *net*
   * change for that path (see the net-diff note below) — ordered for a
   * file-list (modified, then created/renamed, then deleted; alphabetical
   * within each group).
   */
  readonly fileChanges: readonly FileChange[];
  /** `true` when at least one file was changed across all executions. */
  readonly hasFileChanges: boolean;
  /** Number of distinct files changed. */
  readonly fileChangeCount: number;
}

/**
 * Pure derivation hook that aggregates an agent's file changes across every
 * execution in a session into one net change per file. A headless building
 * block for platform builders composing a consolidated session-changes surface
 * (typically paired with {@link FileChangesView}); the Console itself renders
 * file changes in the transcript (stamped edit rows + the per-turn decision
 * bar) and does not consume this hook.
 *
 * **Source (ledger-first).** Under apply-then-review the changes live in the
 * file-review ledger; {@link displayFileChangeSets} reads the server's live
 * projection or folds the durable ledger for a terminal execution (whose
 * projection is nil), and each captured change is projected onto the display
 * {@link FileChange} via {@link toDisplayFileChange}. A pre-capture
 * (legacy) execution has no ledger, so it falls back to the tool-call-coupled
 * `ToolCall.file_changes` (#186; removed in a later slice with that field). The
 * two sources are mutually exclusive per execution, so there is no double count.
 *
 * **Traversal.** The ledger is execution-scoped and already includes sub-agent
 * captures (DD-19), so the primary path is one pass per execution. The legacy
 * fallback walks the same surfaces the server-side approval recompute and
 * `MessageThread` walk: `status.messages[].toolCalls` **and**
 * `status.subAgentExecutions[].messages[].toolCalls`. Executions are visited in
 * chronological order, so each path's change list is chronological.
 *
 * **Net-diff (not latest-wins).** `useSessionWriteBacks`/`useSessionArtifacts`
 * dedup by "latest wins" because each entry is a *snapshot* (a PR; a file's
 * final bytes). A {@link FileChange} is a *delta* — an agent often rewrites the
 * same file several times in a turn, and showing only the last edit's diff
 * would misrepresent what changed. So changes to the same path are reduced to a
 * single net change: `before` from the first change, `after` from the last.
 * Because a WHOLE_FILE `after` is a complete file snapshot, `first.before →
 * last.after` is exactly the net change. A group with one change (the common
 * case) is passed through untouched; multi-edit groups synthesize a net
 * {@link FileChange} so every consumer speaks one proto type (DD-007).
 *
 * Counts and unified diffs for whole-file captures stay derivable by the
 * presentation layer (the runner emits 0/"" sentinels), matching the contract
 * the SDK `tool-view` established.
 *
 * @param executions - All executions for a session, in chronological order.
 *   Pass both completed and active-stream executions.
 *
 * @example
 * ```tsx
 * const allExecutions = [
 *   ...conv.completedExecutions,
 *   ...(conv.activeStreamExecution ? [conv.activeStreamExecution] : []),
 * ];
 * const { fileChanges, hasFileChanges } = useSessionFileChanges(allExecutions);
 * ```
 *
 * @see useSessionWriteBacks — git-mode (PR) counterpart, which does drive the
 *   inspector's Changes tab
 * @see useFileChangeContent — resolves a change's before/after text for diffing
 * @see FileChangesView — component that renders this data
 */
export function useSessionFileChanges(
  executions: readonly AgentExecution[],
): UseSessionFileChangesReturn {
  return useMemo(() => {
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
      // The file-review ledger is the single source under apply-then-review: the
      // display seam reads the live projection or folds the durable ledger for a
      // terminal execution, and the execution-scoped ledger already covers
      // sub-agent captures (DD-19), so one pass suffices. Each CapturedFileChange
      // is projected onto the display FileChange the net-collapse + renderer speak.
      const capturedChanges = displayFileChangeSets(execution.status).flatMap(
        (set) => set.changes,
      );
      for (const captured of capturedChanges) collect(toDisplayFileChange(captured));
    }

    const fileChanges = Array.from(groups.values(), netChange);
    fileChanges.sort(fileChangeComparator);

    return {
      fileChanges,
      hasFileChanges: fileChanges.length > 0,
      fileChangeCount: fileChanges.length,
    };
  }, [executions]);
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
 * session, anchored on its two endpoints, in this precedence:
 *
 * 1. Ends deleted (`last` is DELETE) → DELETE. The file is gone, regardless of
 *    how it got there — this includes create-then-delete, which we deliberately
 *    surface as DELETE rather than hiding the path. (`before` then comes from
 *    the first change, which for a created-then-deleted file is empty, so the
 *    diff reads as the removal of whatever briefly existed.)
 * 2. Started created (`first` is CREATE) and still exists → CREATE. A file born
 *    this session and later modified is, on net, a new file.
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

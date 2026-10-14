// The read seam for a run's file record: the change sets a turn captured,
// with each file's before and after bytes and diff reference
// (`RunStatus.file_changes`).
//
// The record holds no status and no decisions. What was decided about a
// file, and whether it was put back, is the session's
// `stigmer.file_review.*` events, folded by @stigmer/session-log's
// `foldSession` into each turn's `fileReview` sets. A surface shows a
// review from the fold and loads the bytes from here, joined by change-set
// id and file-change id.
//
// This module has no React/framework dependency (mirrors tool-view.ts) so it
// is shared by @stigmer/react and @stigmer/ink.

import type { RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";

/**
 * A run's captured change sets, in the order the run recorded them: its file
 * record. Returns the record's own array (no copy), so memoized consumers
 * keep their reference.
 *
 * @param status - The run status, or `undefined`.
 * @returns The change sets, or an empty array when the run captured none.
 */
export function displayFileChangeSets(
  status: RunStatus | undefined,
): readonly FileChangeSet[] {
  return status?.fileChanges ?? [];
}

/**
 * One captured change set of a run's file record, by its id: what a review
 * card joins to a folded `FileReviewSet` (`changeSetId`) to render its diffs.
 *
 * @param status - The run status, or `undefined`.
 * @param changeSetId - The change set's id.
 * @returns The change set, or `undefined` when the run holds none by that id.
 */
export function fileChangeSetOf(
  status: RunStatus | undefined,
  changeSetId: string,
): FileChangeSet | undefined {
  return displayFileChangeSets(status).find((set) => set.id === changeSetId);
}

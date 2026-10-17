/**
 * The clear of RunStatus.file_change_progress, the live "N files changed
 * so far" strip a turn shows before its change set is captured.
 *
 * Progress is a runner-owned, latest-snapshot display field (the
 * file-review sibling of setup_progress). The runner overwrites it on each
 * mid-run write; the merge keeps it only while the change set it previews
 * is not yet captured on the run's file record (record.ts) and the run has
 * not finished, so it never outlives its turn. Keyed on the change set id:
 * a progress for a set the record already holds captured is a stale one,
 * and clears.
 *
 * Proven by __tests__/progress.test.ts and the merge's tests.
 */
import type {
  FileChangeProgress,
  FileChangeSet,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";

import { isCaptured } from "./record.js";

/** The progress the run keeps after a write (module header). */
export function reconcileFileChangeProgress(
  sets: ReadonlyArray<FileChangeSet>,
  progress: FileChangeProgress | undefined,
  finished: boolean,
): FileChangeProgress | undefined {
  if (progress === undefined || finished || progress.changeSetId === "") {
    return undefined;
  }
  const captured = sets.some((cs) => cs.id === progress.changeSetId && isCaptured(cs));
  return captured ? undefined : progress;
}

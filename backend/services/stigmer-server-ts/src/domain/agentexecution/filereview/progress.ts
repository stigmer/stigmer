/**
 * ReconcileFileChangeProgress — ports filereview/progress.go: the
 * defense-in-depth clear for the transient
 * AgentExecutionStatus.file_change_progress field (mid-run live capture,
 * DD-32).
 *
 * Progress is a runner-owned, latest-snapshot DISPLAY field (the
 * file-review analogue of setup_progress), NOT part of the append-only
 * ledger. The runner overwrites it on each mid-run persist while its
 * change set is CAPTURING; this seam clears it once that set leaves
 * CAPTURING, so a stale mid-run delta never outlives the turn.
 *
 * It runs AFTER projectFileChangeSets so it reads the just-folded
 * projection: progress is KEPT only while a CAPTURING change set with the
 * matching change_set_id exists. A terminal execution is subsumed — the
 * projection is empty there. Keying on change_set_id (not merely "any
 * CAPTURING set") is what makes resume correct: a new turn's new set id
 * no longer matches the stale prior-turn progress, which clears.
 */
import { FileChangeSetStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type {
  FileChangeProgress,
  FileChangeSet,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";

export function reconcileFileChangeProgress(
  sets: FileChangeSet[],
  progress: FileChangeProgress | undefined,
): FileChangeProgress | undefined {
  if (progress === undefined) {
    return undefined;
  }
  if (hasCapturingSet(sets, progress.changeSetId)) {
    return progress;
  }
  return undefined;
}

function hasCapturingSet(
  sets: FileChangeSet[],
  changeSetId: string,
): boolean {
  if (changeSetId === "") {
    return false;
  }
  return sets.some(
    (cs) =>
      cs.id === changeSetId &&
      cs.status === FileChangeSetStatus.CAPTURING,
  );
}

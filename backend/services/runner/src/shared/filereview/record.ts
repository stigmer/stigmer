/**
 * The run's file record (`RunStatus.file_changes`): the change sets this
 * invocation captured, as the server keeps them for Undo and for the
 * review card's diff.
 *
 * The turn's file-review ledger (`TurnRows.file_review_event_stream`, the
 * runner's own) is where capture authors a change set: a BASELINE_CAPTURED
 * at the pin, a CANDIDATE_CAPTURED at the boundary (`capture.ts`). The
 * record is that ledger's capture half: one `FileChangeSet` per change set,
 * carrying its id, turn and harness ids and baseline snapshot from the pin,
 * and, once the boundary captured it, the candidate snapshot, the captured
 * changes (contents inline or by storage key, the diff reference), the
 * aggregate digest, the diff completeness and the approved-command
 * provenance. A set with no candidate snapshot is still being captured; a
 * turn that changed nothing leaves its set that way, recorded and empty. It
 * carries no status and no decisions: those are the session's
 * `stigmer.file_review.*` events. `approved_snapshot` is never set here: an
 * undo is put back by a later turn's start, which writes its outcome to the
 * log and nothing to any run (`harness/owed-undos.ts`).
 *
 * Each set is sent when it changes and not again ({@link FileRecordSender}):
 * at the pin, and once more with its candidate. A write that carries a set
 * costs the server its keep checks, so the status writes in between carry
 * none.
 *
 * The record holds the ledger's own change objects, not copies, so the
 * persist's size guards (`status-offload.ts`), which offload or drop a
 * body on the record, leave the ledger agreeing with it, and a body
 * offloaded once is never uploaded again.
 *
 * The server upserts the record by set id, so a set an earlier invocation
 * of the same run captured stays on the run without being sent again: each
 * invocation's ledger is its own.
 */

import { create } from "@bufbuild/protobuf";
import { FileChangeSetSchema, type FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";

import type { TurnRows } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

/** The ledger's change sets, in the order their baselines opened them (the module header). */
export function fileRecordOf(rows: Pick<TurnRows, "fileReviewEventStream">): FileChangeSet[] {
  const order: string[] = [];
  const sets = new Map<string, FileChangeSet>();
  const setOf = (id: string): FileChangeSet => {
    let set = sets.get(id);
    if (set === undefined) {
      set = create(FileChangeSetSchema, { id });
      sets.set(id, set);
      order.push(id);
    }
    return set;
  };
  for (const event of rows.fileReviewEventStream?.events ?? []) {
    if (event.changeSetId === "") continue;
    switch (event.payload.case) {
      case "baselineCaptured": {
        const baseline = event.payload.value;
        const set = setOf(event.changeSetId);
        set.turnId = baseline.turnId;
        set.harnessId = baseline.harnessId;
        set.baselineSnapshot = baseline.baselineSnapshot;
        break;
      }
      case "candidateCaptured": {
        const candidate = event.payload.value;
        const set = setOf(event.changeSetId);
        set.candidateSnapshot = candidate.candidateSnapshot;
        // The ledger's own array and objects (the module header).
        set.changes = candidate.changes;
        set.aggregateDigest = candidate.aggregateDigest;
        set.diffCompleteness = candidate.diffCompleteness;
        set.commandProvenance = candidate.commandProvenance;
        break;
      }
      default:
        break;
    }
  }
  return order.map((id) => sets.get(id)!);
}

/**
 * Which of the record's sets a write carries: each set once as the pin left
 * it and once more with its candidate, never again (the module header). One
 * per turn, held by the persist chokepoint; a set counts as sent only once a
 * write that carried it landed, so a write that failed carries it again on
 * the next.
 */
export class FileRecordSender {
  /** Set id → whether the landed write carried its candidate. */
  private readonly sent = new Map<string, boolean>();

  /** The sets the next write carries: new ones, and ones whose candidate the server has not seen. */
  pending(rows: Pick<TurnRows, "fileReviewEventStream">): FileChangeSet[] {
    return fileRecordOf(rows).filter((set) => {
      const sentWithCandidate = this.sent.get(set.id);
      if (sentWithCandidate === undefined) return true;
      return !sentWithCandidate && set.candidateSnapshot !== undefined;
    });
  }

  /** A write carrying `sets` landed. */
  written(sets: readonly FileChangeSet[]): void {
    for (const set of sets) this.sent.set(set.id, set.candidateSnapshot !== undefined);
  }
}

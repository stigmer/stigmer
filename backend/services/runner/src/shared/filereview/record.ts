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
 *
 * WHICH SET AN INVOCATION CAPTURES INTO ({@link changeSetIdForInvocation})
 * -----------------------------------------------------------------------
 * A turn is one change set however many invocations it takes. An invocation
 * that runs the turn on, after a drain, a lost runner, a stall the model
 * owed or a Temporal retry, adopts the run's newest set while it is still
 * open (pinned, no candidate yet): its baseline is already the turn's, so
 * pinning again would fold the earlier invocation's edits into a second
 * baseline (#1115). The workflow re-runs a recovered turn at `turnSeq` 0,
 * and a retry at its own, so an invocation whose `turnSeq` is not past the
 * newest set's cycle is that set's turn; one past it is a new approval
 * cycle, which mints `<run>:<turnSeq>` as before, even when the cycle
 * before it changed nothing and so captured no candidate. A minted id an
 * earlier set already holds (a recovery after a captured cycle) takes the
 * first free `.n` suffix, so no invocation writes into a set it does not
 * continue.
 */

import { create } from "@bufbuild/protobuf";
import { FileChangeSetSchema, type FileChangeSet } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";

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

/**
 * The change set this invocation captures into: the run's newest set when
 * this invocation continues it, else a fresh id (the module header).
 */
export function changeSetIdForInvocation(executionId: string, turnSeq: number, record: readonly FileChangeSet[]): string {
  const newest = record.at(-1);
  if (newest !== undefined && isOpen(newest) && turnSeq <= cycleOf(executionId, newest.id)) return newest.id;
  const minted = `${executionId}:${turnSeq}`;
  const taken = new Set(record.map((set) => set.id));
  if (!taken.has(minted)) return minted;
  let n = 1;
  while (taken.has(`${minted}.${n}`)) n += 1;
  return `${minted}.${n}`;
}

/** The set an invocation continues under `changeSetId`: open on the run's record, so its baseline is already pinned. */
export function adoptedChangeSetOf(changeSetId: string, record: readonly FileChangeSet[]): FileChangeSet | undefined {
  return record.find((set) => set.id === changeSetId && isOpen(set));
}

/** Pinned and not yet captured. */
function isOpen(set: FileChangeSet): boolean {
  return set.baselineSnapshot !== undefined && set.candidateSnapshot === undefined;
}

/** The cycle a set of this run was minted for (`<run>:<turnSeq>`, optionally `.n`); -1 for an id of another shape. */
function cycleOf(executionId: string, id: string): number {
  const prefix = `${executionId}:`;
  if (!id.startsWith(prefix)) return -1;
  const match = /^(\d+)(?:\.\d+)?$/.exec(id.slice(prefix.length));
  return match === null ? -1 : Number(match[1]);
}


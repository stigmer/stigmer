/**
 * The undos still owed, done at every turn's start: the one place a person's
 * Undo on a turn that has ended reaches the files.
 *
 * Review never makes a turn wait (stigmer#1471): a turn with review on ends
 * with its edits applied, and a person may undo a change set while it is the
 * conversation's newest turn. Two turns can then take the tree next, in
 * either order: the reconcile turn the decision started, and a message sent
 * right after it (the workspace lock does not order its waiters,
 * `shared/workspace/workspace-lock.ts`). So the undo is not left to one of
 * them: every turn's start does whatever is owed, under the lock, before
 * anything else touches the tree (the eval scaffold, the mounts, the capture
 * baseline), and an Undo always lands before the next model call. Whichever
 * turn takes the tree first does the work; the other reads its
 * `stigmer.file_review.reconciled` and skips.
 *
 * What is owed is keyed per undo, never per change set: a set's files can be
 * undone one at a time, each after the last was put back, and an undo can be
 * decided while a reconcile turn that already read the log is still running.
 * Each undo is answered by its own `reconciled`, whose id names the undo's
 * `decided` event (`events/ids.ts` `fileReviewReconciledEventId`).
 *
 * What is owed is read from the session's log, never from a run: the
 * reconcile result cannot land on the change set's run, which has finished
 * and which this runner may not write. One bounded read, newest first, of
 * `user.message`, `stigmer.file_review.decided` and
 * `stigmer.file_review.reconciled`, back to and including the newest
 * `user.message` that is not this run's: a change set is decidable only
 * while its turn's message is the newest, so no undo older than that slice
 * can still be owed. An `undo` decided in the slice with no `reconciled`
 * answering it is owed. The change set's files are read from its run's
 * file record (`getExecution`, `status.file_changes`), which the run's
 * credential may view as the person who created this run. Its decisions are
 * the slice's own `decided` events for the set, every `keep` and `undo`: a
 * set is decidable only while its turn's message is the newest, so the
 * slice, which reaches back to that message, holds every decision on any
 * set with an undo owed.
 *
 * The work is `shared/filereview/capture.ts` `undoChangeSet`, once per
 * change set with an undo owed, with its hash guard: it restores every file
 * the set's decisions undo, so a file an earlier undo already put back is
 * put back again, unchanged. Its outcome is written at once as one
 * `reconciled` event per owed undo, naming the files that undo covers
 * (`events/emitter.ts` `writeReconciled`). Nothing is written to any ledger.
 *
 * Then, in a message turn only, the capture refs of the previous message
 * turn's run are dropped (`git-substrate.ts` `dropCaptureRefs`): that turn's
 * window closed when this turn's message was sent, so nothing can undo it
 * any more and its pinned trees would only pile up in the workspace. A
 * reconcile turn drops nothing: the window of the turn it serves is still
 * open.
 */

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import type { StigmerClient } from "../client/stigmer-client.js";
import type { ArtifactStorage } from "../shared/artifact-storage.js";
import { undoChangeSet, type LoggedFileDecision, type UndoOutcome } from "../shared/filereview/capture.js";
import { casBlobReader } from "../shared/filereview/cas-substrate.js";
import { changeSetIdParts } from "../shared/filereview/events.js";
import { dropCaptureRefs } from "../shared/filereview/git-substrate.js";
import { fileReviewReconciledEventId } from "./events/ids.js";
import type { TurnWorkspace } from "./types.js";

/** The log types the owed read asks for. */
export const OWED_UNDO_EVENT_TYPES = [
  "user.message",
  "stigmer.file_review.decided",
  "stigmer.file_review.reconciled",
] as const;

/** One page of the owed read: enough for an ordinary turn's decisions in one call. */
const OWED_READ_PAGE_SIZE = 200;

/** One undo still owed: its `decided` event, and what it covers. */
export interface OwedUndo {
  readonly decidedEventId: string;
  readonly changeSetId: string;
  /** `change_set` (every file the set's decisions undo) or `file` (the one file). */
  readonly scope: string;
  /** The file decided, for scope `file`. */
  readonly fileChangeId: string;
}

/** The answer to one undo, written as its `stigmer.file_review.reconciled`. */
export interface ReconciledUndo extends UndoOutcome {
  readonly decidedEventId: string;
}

/** What the owed read found: the undos owed, oldest first, each set's decisions, and the previous message turn's run. */
export interface OwedUndos {
  readonly undos: readonly OwedUndo[];
  /** Every decision the slice holds, by change set id, oldest first: what an undo of the set reads. */
  readonly decisions: ReadonlyMap<string, readonly LoggedFileDecision[]>;
  /** The run of the newest `user.message` that is not this run's; `undefined` when there is none. */
  readonly previousMessageRunId: string | undefined;
}

/**
 * Read what is owed from the log (the module header). Pages newest first
 * until the newest `user.message` that is not `runId`'s, that event
 * included, or the log's start.
 */
export async function readOwedUndos(
  client: Pick<StigmerClient, "listSessionEvents">,
  sessionId: string,
  runId: string,
): Promise<OwedUndos> {
  const slice: SessionEvent[] = [];
  let previousMessageRunId: string | undefined;
  let pageToken = "";
  read: do {
    const page = await client.listSessionEvents(sessionId, {
      types: OWED_UNDO_EVENT_TYPES,
      order: "desc",
      pageSize: OWED_READ_PAGE_SIZE,
      pageToken,
    });
    for (const event of page.events) {
      slice.push(event);
      if (event.event.case === "userMessage" && event.runId !== runId) {
        previousMessageRunId = event.runId;
        break read;
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken !== "");
  return { undos: owedUndos(slice), decisions: decisionsBySet(slice), previousMessageRunId };
}

/**
 * The `decided` events in `slice` (newest first, as read), by change set,
 * oldest first. A decision on a set is written under the set's own run (the
 * set id's `<run id>:` part); one written under any other run decides
 * nothing here.
 */
export function decisionsBySet(slice: readonly SessionEvent[]): Map<string, LoggedFileDecision[]> {
  const out = new Map<string, LoggedFileDecision[]>();
  for (const event of [...slice].reverse()) {
    if (event.event.case !== "stigmerFileReviewDecided") continue;
    const { changeSetId, scope, fileChangeId, action } = event.event.value;
    if (event.runId !== changeSetIdParts(changeSetId).runId) continue;
    const list = out.get(changeSetId) ?? [];
    list.push({ scope, fileChangeId, action });
    out.set(changeSetId, list);
  }
  return out;
}

/**
 * The undos decided in `slice` (newest first, as read) that no `reconciled`
 * answers, oldest first, each once.
 */
export function owedUndos(slice: readonly SessionEvent[]): OwedUndo[] {
  const answered = new Set<string>();
  for (const event of slice) {
    if (event.event.case === "stigmerFileReviewReconciled") answered.add(event.event.value.id);
  }
  const owed: OwedUndo[] = [];
  for (const event of [...slice].reverse()) {
    if (event.event.case !== "stigmerFileReviewDecided" || event.event.value.action !== "undo") continue;
    const { id, changeSetId, scope, fileChangeId } = event.event.value;
    if (answered.has(fileReviewReconciledEventId(changeSetId, id)) || owed.some((undo) => undo.decidedEventId === id)) continue;
    owed.push({ decidedEventId: id, changeSetId, scope, fileChangeId });
  }
  return owed;
}

/** What {@link reconcileOwedUndos} needs from its caller. */
export interface OwedUndoDeps {
  readonly client: Pick<StigmerClient, "listSessionEvents" | "getExecution">;
  /** The run this turn serves. */
  readonly runId: string;
  readonly sessionId: string;
  readonly workspace: Pick<TurnWorkspace, "primaryDir" | "gitWorkspace">;
  readonly artifactStorage: ArtifactStorage | undefined;
  /** A reconcile turn (`RunSpec.reconcile_file_review`): it drops no refs. */
  readonly reconcileTurn: boolean;
  /** Writes the answers as `stigmer.file_review.reconciled`, at once (`events/emitter.ts` `writeReconciled`). */
  readonly recordReconciled: (answers: readonly ReconciledUndo[]) => Promise<void>;
}

/**
 * Do every undo still owed (the module header) and return what each change
 * set put back. A turn with no primary tree has no files to put back and
 * reads nothing. A change set that cannot be read from its run answers
 * `reconcile_failed`, so its undos are recorded once and not tried again by
 * every later start of the same window.
 */
export async function reconcileOwedUndos(deps: OwedUndoDeps): Promise<readonly UndoOutcome[]> {
  const { client, runId, sessionId, workspace } = deps;
  const gitRoot = workspace.primaryDir;
  if (!gitRoot) return [];

  const owed = await readOwedUndos(client, sessionId, runId);
  const outcomes: UndoOutcome[] = [];
  const answers: ReconciledUndo[] = [];
  for (const changeSetId of [...new Set(owed.undos.map((undo) => undo.changeSetId))]) {
    const outcome = await undoOne(deps, gitRoot, changeSetId, owed.decisions.get(changeSetId) ?? []);
    outcomes.push(outcome);
    for (const undo of owed.undos.filter((owedUndo) => owedUndo.changeSetId === changeSetId)) {
      answers.push(answerFor(undo, outcome));
    }
  }
  if (outcomes.length > 0) {
    for (const outcome of outcomes) {
      console.log(
        `[owed-undos] run=${runId}: change set ${outcome.changeSetId}: ` +
          (outcome.failure === "" ? `put back ${outcome.undonePaths.length} file(s)` : `${outcome.failure}: ${outcome.failureDetail}`),
      );
    }
    await deps.recordReconciled(answers);
  }

  if (!deps.reconcileTurn && workspace.gitWorkspace && owed.previousMessageRunId !== undefined) {
    await dropCaptureRefs(gitRoot, owed.previousMessageRunId);
  }
  return outcomes;
}

/**
 * One undo's answer from its change set's outcome: the files it covers that
 * were put back (every one for a change-set undo, its own file for a file
 * undo), or the set's failure.
 */
function answerFor(undo: OwedUndo, outcome: UndoOutcome): ReconciledUndo {
  const undonePaths =
    outcome.failure !== "" || undo.scope !== "file"
      ? outcome.undonePaths
      : outcome.undonePaths.filter((path) => `${undo.changeSetId}:${path}` === undo.fileChangeId);
  return { ...outcome, undonePaths, decidedEventId: undo.decidedEventId };
}

/** One owed change set: read its files from its run's file record, then undo it under the decisions the log holds. */
async function undoOne(
  deps: OwedUndoDeps,
  gitRoot: string,
  changeSetId: string,
  decisions: readonly LoggedFileDecision[],
): Promise<UndoOutcome> {
  const failed = (failureDetail: string): UndoOutcome => ({ changeSetId, undonePaths: [], failure: "reconcile_failed", failureDetail });
  let run: Run;
  try {
    run = await deps.client.getExecution(changeSetIdParts(changeSetId).runId);
  } catch (err) {
    return failed(`the turn's changes could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }
  const changeSet = run.status?.fileChanges.find((set) => set.id === changeSetId);
  if (changeSet === undefined) return failed("the turn holds no such change set");
  return undoChangeSet({
    gitRoot,
    changeSet,
    decisions,
    gitWorkspace: deps.workspace.gitWorkspace,
    readBlob: deps.artifactStorage ? casBlobReader(deps.artifactStorage) : undefined,
  });
}

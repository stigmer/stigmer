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
 * What is owed is read from the session's log, never from a run: the
 * reconcile result cannot land on the change set's run, which has finished
 * and which this runner may not write. One bounded read, newest first, of
 * `user.message`, `stigmer.file_review.decided` and
 * `stigmer.file_review.reconciled`, back to and including the newest
 * `user.message` that is not this run's: a change set is decidable only
 * while its turn's message is the newest, so no undo older than that slice
 * can still be owed. An `undo` decided in the slice whose change set has no
 * `reconciled` in it is owed. The change set itself (its files, its
 * decisions) is read from its run (`getExecution`, `status.file_change_sets`),
 * which the run's credential may view as the person who created this run.
 *
 * The work is `shared/filereview/capture.ts` `undoChangeSet`, with its hash
 * guard; its outcome is written at once as one `reconciled` event per change
 * set (`events/emitter.ts` `writeReconciled`). Nothing is written to any
 * ledger.
 *
 * Then, in a message turn only, the capture refs of the previous message
 * turn's run are dropped (`git-substrate.ts` `dropCaptureRefs`): that turn's
 * window closed when this turn's message was sent, so nothing can undo it
 * any more and its pinned trees would only pile up in the workspace. A
 * reconcile turn drops nothing: the window of the turn it serves is still
 * open.
 */

import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import type { StigmerClient } from "../client/stigmer-client.js";
import type { ArtifactStorage } from "../shared/artifact-storage.js";
import { undoChangeSet, type UndoOutcome } from "../shared/filereview/capture.js";
import { casBlobReader } from "../shared/filereview/cas-substrate.js";
import { changeSetIdParts } from "../shared/filereview/events.js";
import { dropCaptureRefs } from "../shared/filereview/git-substrate.js";
import type { TurnWorkspace } from "./types.js";

/** The log types the owed read asks for. */
export const OWED_UNDO_EVENT_TYPES = [
  "user.message",
  "stigmer.file_review.decided",
  "stigmer.file_review.reconciled",
] as const;

/** One page of the owed read: enough for an ordinary turn's decisions in one call. */
const OWED_READ_PAGE_SIZE = 200;

/** What the owed read found: the change sets to undo, oldest decision first, and the previous message turn's run. */
export interface OwedUndos {
  readonly changeSetIds: readonly string[];
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
  return { changeSetIds: owedChangeSets(slice), previousMessageRunId };
}

/**
 * The change sets an `undo` was decided on in `slice` (newest first, as
 * read) with no `reconciled` beside it, oldest decision first, each once.
 */
export function owedChangeSets(slice: readonly SessionEvent[]): string[] {
  const reconciled = new Set<string>();
  for (const event of slice) {
    if (event.event.case === "stigmerFileReviewReconciled") reconciled.add(event.event.value.changeSetId);
  }
  const owed: string[] = [];
  for (const event of [...slice].reverse()) {
    if (event.event.case !== "stigmerFileReviewDecided" || event.event.value.action !== "undo") continue;
    const { changeSetId } = event.event.value;
    if (!reconciled.has(changeSetId) && !owed.includes(changeSetId)) owed.push(changeSetId);
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
  /** Writes the outcomes as `stigmer.file_review.reconciled`, at once (`events/emitter.ts` `writeReconciled`). */
  readonly recordReconciled: (outcomes: readonly UndoOutcome[]) => Promise<void>;
}

/**
 * Do every undo still owed (the module header) and return what each put
 * back. A turn with no primary tree has no files to put back and reads
 * nothing. A change set that cannot be read from its run answers
 * `reconcile_failed`, so it is recorded once and not tried again by every
 * later start of the same window.
 */
export async function reconcileOwedUndos(deps: OwedUndoDeps): Promise<readonly UndoOutcome[]> {
  const { client, runId, sessionId, workspace } = deps;
  const gitRoot = workspace.primaryDir;
  if (!gitRoot) return [];

  const owed = await readOwedUndos(client, sessionId, runId);
  const outcomes: UndoOutcome[] = [];
  for (const changeSetId of owed.changeSetIds) {
    outcomes.push(await undoOne(deps, gitRoot, changeSetId));
  }
  if (outcomes.length > 0) {
    for (const outcome of outcomes) {
      console.log(
        `[owed-undos] run=${runId}: change set ${outcome.changeSetId}: ` +
          (outcome.failure === "" ? `put back ${outcome.undonePaths.length} file(s)` : `${outcome.failure}: ${outcome.failureDetail}`),
      );
    }
    await deps.recordReconciled(outcomes);
  }

  if (!deps.reconcileTurn && workspace.gitWorkspace && owed.previousMessageRunId !== undefined) {
    await dropCaptureRefs(gitRoot, owed.previousMessageRunId);
  }
  return outcomes;
}

/** One owed change set: read it from its run, then undo it. */
async function undoOne(deps: OwedUndoDeps, gitRoot: string, changeSetId: string): Promise<UndoOutcome> {
  const failed = (failureDetail: string): UndoOutcome => ({ changeSetId, undonePaths: [], failure: "reconcile_failed", failureDetail });
  let run: Run;
  try {
    run = await deps.client.getExecution(changeSetIdParts(changeSetId).runId);
  } catch (err) {
    return failed(`the turn's changes could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }
  const changeSet = run.status?.fileChangeSets.find((set) => set.id === changeSetId);
  if (changeSet === undefined) return failed("the turn holds no such change set");
  return undoChangeSet({
    gitRoot,
    changeSet,
    gitWorkspace: deps.workspace.gitWorkspace,
    readBlob: deps.artifactStorage ? casBlobReader(deps.artifactStorage) : undefined,
  });
}

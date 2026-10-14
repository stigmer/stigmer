/**
 * The server's side of file review, mirrored for the hermetic record — the
 * ONE place a runner test stands in for the control plane's file record and
 * decision core.
 *
 * Production: the runner sends the change sets its invocation captured on
 * every status write (`RunStatus.file_changes`, `shared/filereview/record.ts`),
 * and the server upserts them on the run by set id, so a set an earlier
 * invocation sent stays. A person's Keep or Undo is the decision core's: it
 * writes each decision into the session's log as
 * `stigmer.file_review.decided`, and a later turn's start reads the undone
 * sets' files back from the run's record and the decisions from the log and
 * puts the files back (`harness/owed-undos.ts`). The hermetic
 * `ExecutionRecord` is the server here, so it upserts the same way
 * ({@link upsertFileChanges}) and decides only files the log holds no
 * decision for ({@link decideCapturedFileChanges}).
 *
 * Mirrored, not imported: the runner is a standalone package and cannot
 * reach the server's source. The conformance suite's file-review files
 * (`test/conformance/src/suites-execution/agentexecution-file-review*`) are
 * the arbiter that the two still agree, through the real server.
 */

import { clone } from "@bufbuild/protobuf";
import { FileChangeSetSchema, type FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";

/** The server's merge of a written record onto the held one: each set replaced by id, a new one appended, none removed. */
export function upsertFileChanges(held: readonly FileChangeSet[], written: readonly FileChangeSet[]): FileChangeSet[] {
  const out = held.map((set) => clone(FileChangeSetSchema, set));
  for (const set of written) {
    const index = out.findIndex((h) => h.id === set.id);
    if (index < 0) out.push(clone(FileChangeSetSchema, set));
    else out[index] = clone(FileChangeSetSchema, set);
  }
  return out;
}

/** The paths a reviewer decides, by workspace-relative path (the change's `path_after || path_before`). */
export interface FileReviewVerdicts {
  readonly approve?: readonly string[];
  readonly reject?: readonly string[];
}

/** One decision the decision core writes, as its `stigmer.file_review.decided` states it. */
export interface KitFileDecision {
  readonly changeSetId: string;
  readonly fileChangeId: string;
  readonly action: "keep" | "undo";
  readonly expectedDigest: string;
}

/**
 * What the server's decision core writes once every change of every
 * captured set not yet decided has a per-file verdict: one file-scoped
 * decision per change the log holds none for. A path in neither list is a
 * test bug and throws (an undecided change is left as it is, which would
 * hide the mistake). Returns the decisions, in order.
 */
export function decideCapturedFileChanges(
  fileChanges: readonly FileChangeSet[],
  decidedFileIds: ReadonlySet<string>,
  verdicts: FileReviewVerdicts,
): KitFileDecision[] {
  const approve = new Set(verdicts.approve ?? []);
  const reject = new Set(verdicts.reject ?? []);
  const written: KitFileDecision[] = [];
  for (const set of fileChanges) {
    for (const change of set.changes) {
      if (decidedFileIds.has(change.id)) continue;
      const path = change.pathAfter || change.pathBefore;
      const action = approve.has(path) ? "keep" : reject.has(path) ? "undo" : undefined;
      if (action === undefined) throw new Error(`decideCapturedFileChanges: no verdict for '${path}' in change set '${set.id}' (test bug)`);
      written.push({ changeSetId: set.id, fileChangeId: change.id, action, expectedDigest: change.fileDigest });
    }
  }
  return written;
}

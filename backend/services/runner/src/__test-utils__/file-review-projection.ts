/**
 * The server's `file_change_sets` projection, mirrored for the hermetic
 * record — the ONE place a runner test stands in for the control plane's
 * fold of the file-review ledger.
 *
 * Production: the runner authors BASELINE_CAPTURED and CANDIDATE_CAPTURED
 * onto `status.file_review_event_stream`; the server folds the stream into
 * `status.file_change_sets` (`stigmer-server/src/domain/agentexecution/
 * filereview/project.ts` `applyEvent` and `deriveStatusAfterCandidate`);
 * `SubmitFileDecision` appends FILE_DECIDED events and re-folds; the runtime's
 * reinvocation reads the DECIDED sets back and reconciles the tree
 * (`harness/turn-context.ts` `reconcileReinvocation`). The hermetic
 * `ExecutionRecord` is the server here, so it must fold the same way — and
 * only for the fields the reconcile reads: `id`, `status`, `decisions`,
 * `changes` (their `id`, `beforeSha256`, `afterSha256`), `candidateSnapshot`.
 *
 * Mirrored, not imported: the runner is a standalone package and cannot
 * reach the server's source. If `project.ts` changes the fold, THIS file is
 * the one to change beside it; the conformance suite's file-review files
 * (`test/conformance/src/suites-execution/agentexecution-file-review*`) are
 * the arbiter that the two still agree, through the real server.
 */

import { create } from "@bufbuild/protobuf";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionOrigin,
  FileDecisionScope,
  FileReviewEventType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  FileChangeSetSchema,
  FileDecisionSchema,
  type FileChangeSet,
  type FileReviewEvent,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";

/** Fold the ledger into change sets, in first-seen order (`project.ts` `projectFileChangeSets`). */
export function projectFileChangeSets(events: readonly FileReviewEvent[]): FileChangeSet[] {
  const order: string[] = [];
  const byId = new Map<string, FileChangeSet>();
  for (const ev of events) {
    if (ev.changeSetId === "") continue;
    let cs = byId.get(ev.changeSetId);
    if (!cs) {
      cs = create(FileChangeSetSchema, { id: ev.changeSetId });
      byId.set(ev.changeSetId, cs);
      order.push(ev.changeSetId);
    }
    applyEvent(cs, ev);
  }
  return order.map((id) => byId.get(id)!);
}

/** One event into one set (`project.ts` `applyEvent`); terminal statuses are never downgraded. */
function applyEvent(cs: FileChangeSet, ev: FileReviewEvent): void {
  switch (ev.eventType) {
    case FileReviewEventType.BASELINE_CAPTURED:
      if (ev.payload.case === "baselineCaptured") {
        cs.turnId = ev.payload.value.turnId;
        cs.harnessId = ev.payload.value.harnessId;
        cs.baselineSnapshot = ev.payload.value.baselineSnapshot;
      }
      cs.status = FileChangeSetStatus.CAPTURING;
      break;
    case FileReviewEventType.CANDIDATE_CAPTURED:
      if (ev.payload.case === "candidateCaptured") {
        cs.candidateSnapshot = ev.payload.value.candidateSnapshot;
        cs.changes = ev.payload.value.changes;
        cs.aggregateDigest = ev.payload.value.aggregateDigest;
        cs.diffCompleteness = ev.payload.value.diffCompleteness;
      }
      cs.status = deriveStatusAfterCandidate(cs);
      break;
    case FileReviewEventType.FILE_DECIDED:
      if (ev.payload.case === "fileDecided") cs.decisions.push(ev.payload.value);
      cs.status = deriveStatusAfterCandidate(cs);
      break;
    case FileReviewEventType.RECONCILED:
      if (ev.payload.case === "reconciled") cs.approvedSnapshot = ev.payload.value.approvedSnapshot;
      cs.status = FileChangeSetStatus.RECONCILED;
      break;
    case FileReviewEventType.FAILED:
      cs.status = FileChangeSetStatus.FAILED;
      break;
    default:
      break;
  }
}

function deriveStatusAfterCandidate(cs: FileChangeSet): FileChangeSetStatus {
  if (cs.status === FileChangeSetStatus.RECONCILED || cs.status === FileChangeSetStatus.FAILED) return cs.status;
  return isFullyDecided(cs) ? FileChangeSetStatus.DECIDED : FileChangeSetStatus.AWAITING_REVIEW;
}

function isFullyDecided(cs: FileChangeSet): boolean {
  if (cs.changes.length === 0) return false;
  const decided = new Set<string>();
  for (const d of cs.decisions) {
    if (d.scope === FileDecisionScope.CHANGE_SET) return true;
    if (d.scope === FileDecisionScope.FILE) decided.add(d.fileChangeId);
  }
  return cs.changes.every((c) => decided.has(c.id));
}

/** The paths a reviewer decides, by workspace-relative path (the change's `path_after || path_before`). */
export interface FileReviewVerdicts {
  readonly approve?: readonly string[];
  readonly reject?: readonly string[];
}

/**
 * What the server's `SubmitFileDecision` leaves on the status once every
 * change of every captured set has a per-file verdict: the sets projected
 * from the ledger the runner persisted, each DECIDED, with one FILE-scoped
 * decision per change. A path in neither list is a test bug and throws
 * (the reconcile treats an undecided change as rejected, which would hide
 * the mistake). Returns the number of decisions written.
 */
export function decideCapturedFileChanges(
  status: AgentExecutionStatus,
  verdicts: FileReviewVerdicts,
  decidedAt: string,
): number {
  const approve = new Set(verdicts.approve ?? []);
  const reject = new Set(verdicts.reject ?? []);
  const sets = projectFileChangeSets(status.fileReviewEventStream?.events ?? []);
  let decisions = 0;
  for (const cs of sets) {
    if (cs.status !== FileChangeSetStatus.AWAITING_REVIEW) continue;
    for (const change of cs.changes) {
      const path = change.pathAfter || change.pathBefore;
      const action = approve.has(path) ? FileDecisionAction.APPROVE : reject.has(path) ? FileDecisionAction.REJECT : undefined;
      if (action === undefined) throw new Error(`decideCapturedFileChanges: no verdict for '${path}' in change set '${cs.id}' (test bug)`);
      cs.decisions.push(
        create(FileDecisionSchema, {
          id: `${cs.id}:decision:${decisions}`,
          changeSetId: cs.id,
          scope: FileDecisionScope.FILE,
          fileChangeId: change.id,
          action,
          expectedDigest: change.fileDigest,
          reviewerId: "kit-reviewer",
          decidedAt,
          origin: FileDecisionOrigin.USER,
        }),
      );
      decisions += 1;
    }
    cs.status = deriveStatusAfterCandidate(cs);
  }
  status.fileChangeSets = sets;
  return decisions;
}

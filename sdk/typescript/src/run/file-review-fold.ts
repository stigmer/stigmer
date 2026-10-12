// Framework-agnostic fold of the file-review event ledger into FileChangeSets.
//
// The server persists an append-only `file_review_event_stream` ledger on the
// run status and computes `file_change_sets` as its projection, for a
// finished run too: a turn never waits for review, and its edits stay
// decidable after it ends. A status read without the projection (an older
// server that emptied it for a terminal run, or a trimmed status) is
// displayed by folding the always-preserved ledger here.
//
// `foldFileReviewEventStream` is the TypeScript port of the Go projector
// `ProjectFileChangeSets` (backend/services/stigmer-server/pkg/domain/
// agentexecution/filereview/project.go), and its Java mirror
// `FileChangeSetProjector`. Every rule (first-seen change-set ordering,
// last-writer-wins scalars, decision accumulation, wholesale change
// replacement, sticky terminal status) matches the server exactly, so live
// and settled views agree.
//
// Parity is not maintained by discipline: the shared cross-edition corpus at
// apis/testdata/hitl/file-review/*.json — already replayed by the Go and Java
// projector suites — is replayed against this fold too (see the corpus parity
// test), so a drift between TS and the backends fails a test rather than
// shipping.
//
// This module has no React/framework dependency (mirrors tool-view.ts) so it is
// shared by @stigmer/react and @stigmer/ink and mirror-able by the Go CLI.

import { create } from "@bufbuild/protobuf";
import type { RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type {
  FileChangeSet,
  FileReviewEvent,
  FileReviewEventStream,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { FileChangeSetSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import {
  FileChangeSetStatus,
  FileDecisionScope,
  FileReviewEventType,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

/**
 * Folds a file-review event ledger into its list of {@link FileChangeSet}s,
 * grouped by `change_set_id` in first-seen order.
 *
 * This is the display fold, the server projection's twin: a status that
 * carries no projection still yields its sets. Prefer the server-computed
 * `status.file_change_sets` when present (it is structurally shared across
 * stream frames) — see {@link displayFileChangeSets}.
 *
 * The fold is a faithful port of the Go/Java projector: scalar and snapshot
 * fields are last-writer-wins, `decisions` accumulate, `changes` are replaced
 * wholesale by the latest `CANDIDATE_CAPTURED`, and terminal `RECONCILED` /
 * `FAILED` statuses are sticky (a later non-terminal event never downgrades
 * them).
 *
 * @param stream - The run's `file_review_event_stream`, or `undefined`.
 * @returns One {@link FileChangeSet} per `change_set_id`, in first-seen order.
 */
export function foldFileReviewEventStream(
  stream: FileReviewEventStream | undefined,
): FileChangeSet[] {
  if (!stream || stream.events.length === 0) return [];

  const order: string[] = [];
  const byId = new Map<string, FileChangeSet>();

  for (const ev of stream.events) {
    const changeSetId = ev.changeSetId;
    // An event with no correlation id cannot be attributed to a set; the server
    // skips it, so we do too.
    if (!changeSetId) continue;

    let set = byId.get(changeSetId);
    if (!set) {
      set = create(FileChangeSetSchema, { id: changeSetId });
      byId.set(changeSetId, set);
      order.push(changeSetId);
    }
    applyEvent(set, ev);
  }

  return order.map((id) => byId.get(id)!);
}

/**
 * The single read seam for displaying a run's file change sets.
 *
 * Returns the server-computed `status.file_change_sets` projection when it is
 * present (the projection is structurally shared across stream frames, so
 * consumers keep stable references and streaming re-renders stay scoped to
 * the actively-changing card), and otherwise folds the ledger (a status read
 * without the projection; the ledger is always preserved).
 *
 * The two branches are equivalent by construction (the fold IS the server
 * projection — locked by the corpus parity test), so this accessor is a
 * single consistent source whichever branch it takes.
 *
 * @param status - The run status, or `undefined`.
 * @returns The change sets to display, or an empty array when there are none.
 */
export function displayFileChangeSets(
  status: RunStatus | undefined,
): FileChangeSet[] {
  const projected = status?.fileChangeSets;
  if (projected && projected.length > 0) return projected;
  return foldFileReviewEventStream(status?.fileReviewEventStream);
}

/**
 * Applies one ledger event to its change-set accumulator, mirroring the Go
 * projector's `applyEvent`. The switch is keyed on `event_type` (the coarse
 * bucket the server keys on); the typed payload is read defensively so a
 * malformed event degrades to zero values exactly as the Go nil-getters do,
 * rather than throwing.
 */
function applyEvent(set: FileChangeSet, ev: FileReviewEvent): void {
  switch (ev.eventType) {
    case FileReviewEventType.BASELINE_CAPTURED: {
      const b =
        ev.payload.case === "baselineCaptured" ? ev.payload.value : undefined;
      set.turnId = b?.turnId ?? "";
      set.harnessId = b?.harnessId ?? "";
      set.baselineSnapshot = b?.baselineSnapshot;
      set.status = FileChangeSetStatus.CAPTURING;
      break;
    }

    case FileReviewEventType.CANDIDATE_CAPTURED: {
      const c =
        ev.payload.case === "candidateCaptured" ? ev.payload.value : undefined;
      set.candidateSnapshot = c?.candidateSnapshot;
      set.changes = c?.changes ?? [];
      set.aggregateDigest = c?.aggregateDigest ?? "";
      set.diffCompleteness = c?.diffCompleteness ?? set.diffCompleteness;
      set.status = deriveStatusAfterCandidate(set);
      break;
    }

    case FileReviewEventType.FILE_DECIDED: {
      if (ev.payload.case === "fileDecided") {
        set.decisions.push(ev.payload.value);
      }
      set.status = deriveStatusAfterCandidate(set);
      break;
    }

    case FileReviewEventType.RECONCILED: {
      const r = ev.payload.case === "reconciled" ? ev.payload.value : undefined;
      set.approvedSnapshot = r?.approvedSnapshot;
      set.status = FileChangeSetStatus.RECONCILED;
      break;
    }

    case FileReviewEventType.FAILED: {
      set.status = FileChangeSetStatus.FAILED;
      break;
    }

    // UNSPECIFIED / any future type: ignored, matching the Go projector.
    default:
      break;
  }
}

/**
 * Derives a change set's status after a candidate or decision event, mirroring
 * the Go projector's `deriveStatusAfterCandidate`. Terminal statuses are sticky:
 * a `FILE_DECIDED` arriving after `RECONCILED`/`FAILED` never reverts the set to
 * an actionable state.
 */
function deriveStatusAfterCandidate(set: FileChangeSet): FileChangeSetStatus {
  if (
    set.status === FileChangeSetStatus.RECONCILED ||
    set.status === FileChangeSetStatus.FAILED
  ) {
    return set.status;
  }
  return isFullyDecided(set)
    ? FileChangeSetStatus.DECIDED
    : FileChangeSetStatus.AWAITING_REVIEW;
}

/**
 * Whether every captured change in the set has a verdict, mirroring the Go
 * projector's `isFullyDecided`: a set with no captured changes is never fully
 * decided; any CHANGE_SET-scoped decision covers all files; otherwise every
 * change id must appear among the FILE-scoped decisions.
 */
function isFullyDecided(set: FileChangeSet): boolean {
  if (set.changes.length === 0) return false;

  const decidedFileIds = new Set<string>();
  for (const decision of set.decisions) {
    if (decision.scope === FileDecisionScope.CHANGE_SET) return true;
    if (decision.scope === FileDecisionScope.FILE) {
      decidedFileIds.add(decision.fileChangeId);
    }
  }

  for (const change of set.changes) {
    if (!decidedFileIds.has(change.id)) return false;
  }
  return true;
}

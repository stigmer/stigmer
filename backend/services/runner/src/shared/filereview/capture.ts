/**
 * Harness-agnostic capture-mode turn orchestration for the apply-then-review
 * HITL subsystem. This is the glue between the git snapshot/restore substrate
 * ({@link ./git-substrate.js}) and the file-review ledger ({@link ./events.js}):
 * it turns "the agent edited files freely this turn" into the append-only
 * `file_review` events the server folds into `file_change_sets` (the single
 * review surface), and on resume reconciles the tree to the user's decisions.
 *
 * It is parameterized by `harnessId` (stamped onto the BASELINE payload, which is
 * the projection's source of truth for `turn_id`/`harness_id`) and `excludePaths`
 * (the runner-owned files a harness writes into the workspace), so the Cursor and
 * deep-agent harnesses author IDENTICAL ledger entries through this one seam. Each
 * harness keeps only its presentation concerns (e.g. hiding flowed transcript
 * rows) in its own adapter.
 *
 * Identity: the change set id is `${executionId}:${turnSeq}` (one turn = one
 * change set), minted by the caller; each file's stable id is
 * `${changeSetId}:${pathAfter||pathBefore}` so the resume can map a per-file
 * decision back to its path without depending on any other identity.
 */

import { create } from "@bufbuild/protobuf";
import {
  FileCaptureClass,
  FileChangeKind,
  FileChangeType,
  FileDecisionAction,
  FileDecisionScope,
  FileReviewFailureKind,
  SnapshotKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { FileContent } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  GitTreeRefSchema,
  SnapshotRefSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import type {
  CapturedFileChange,
  FileChangeSet,
  SnapshotRef,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { utcTimestamp } from "../status.js";
import {
  appendFileReviewEvents,
  buildBaselineCapturedEvent,
  buildCandidateCapturedEvent,
  buildCapturedFileChange,
  buildFailedEvent,
  buildReconciledEvent,
  type CapturedChangeInput,
  type ChangeSetContext,
} from "./events.js";
import { sha256Bytes } from "./digest.js";
import {
  applyApprovedPaths,
  baselineRef,
  captureChangeSet,
  captureRef,
  dropCaptureRefs,
  recomputeChangeSet,
  restoreToBaseline,
  snapshotApproved,
  snapshotBaseline,
  type CapturedFileChange as GitCapturedChange,
} from "./git-substrate.js";

/**
 * Turn start: pin the pre-turn working tree behind the baseline ref and author
 * the BASELINE_CAPTURED event. The projection reads `turn_id`/`harness_id` ONLY
 * from this payload, so `turnId == changeSetId` (one turn = one change set) and
 * `harnessId` identifies the producer. Returns the baseline tree sha for the
 * turn-end diff. Appends onto `status.fileReviewEventStream`; the event rides the
 * next persist.
 */
export async function captureBaselineToLedger(opts: {
  readonly status: AgentExecutionStatus;
  readonly gitRoot: string;
  readonly executionId: string;
  readonly changeSetId: string;
  readonly harnessId: string;
  readonly excludePaths?: readonly string[];
}): Promise<string> {
  const { status, gitRoot, executionId, changeSetId, harnessId, excludePaths } = opts;
  const baselineTree = await snapshotBaseline(gitRoot, executionId, excludePaths);
  const event = buildBaselineCapturedEvent(
    changeSetContext(changeSetId, harnessId),
    gitTreeSnapshotRef(baselineTree, baselineRef(executionId)),
  );
  appendFileReviewEvents(status, executionId, [event]);
  return baselineTree;
}

/**
 * Turn end: capture the change set, LEAVE the working tree in its applied
 * ("after") state (the user reviews the real change; nothing is committed and the
 * next turn is blocked until they decide), and author the CANDIDATE_CAPTURED
 * event. The pinned baseline/after refs are the authoritative source for the
 * resume-time reconcile ({@link applyCaptureDecisions}).
 *
 * Presentation (hiding the harness's flowed transcript rows so `file_change_sets`
 * is the single review surface) is the harness adapter's concern, not this seam's.
 * Returns the captured changes. No-op authoring when the turn changed nothing.
 */
export async function captureCandidateToLedger(opts: {
  readonly status: AgentExecutionStatus;
  readonly gitRoot: string;
  readonly executionId: string;
  readonly changeSetId: string;
  readonly baselineTree: string;
  readonly harnessId: string;
  readonly excludePaths?: readonly string[];
}): Promise<readonly GitCapturedChange[]> {
  const { status, gitRoot, executionId, changeSetId, baselineTree, harnessId, excludePaths } = opts;

  const { afterTree, changes } = await captureChangeSet(
    gitRoot,
    executionId,
    baselineTree,
    excludePaths,
  );
  if (changes.length === 0) return changes;

  const captured = changes.map((change) =>
    buildCapturedFileChange(toCapturedChangeInput(changeSetId, change)),
  );
  const event = buildCandidateCapturedEvent(
    changeSetContext(changeSetId, harnessId),
    gitTreeSnapshotRef(afterTree, captureRef(executionId)),
    captured,
  );
  appendFileReviewEvents(status, executionId, [event]);
  return changes;
}

/** Outcome of reconciling a DECIDED change set's decisions on resume. */
export interface CaptureResumeResult {
  /** False when this resume is not a capture turn (no capture ref present). */
  readonly isCaptureTurn: boolean;
  /** Repo-relative paths applied (approved) to the working tree. */
  readonly approvedPaths: readonly string[];
  /** Repo-relative paths discarded (rejected / undecided-then-skipped). */
  readonly rejectedPaths: readonly string[];
  /** True when at least one file was rejected. */
  readonly hadReject: boolean;
  /**
   * True when an approved file's on-disk bytes no longer hash to the digest the
   * user approved: a FileReviewFailure(HASH_MISMATCH) was authored and NOTHING
   * was applied (what-you-approve-is-what-applies is a hard gate).
   */
  readonly failed: boolean;
  /** Human-readable detail when {@link failed} (the diverged paths). */
  readonly failureDetail?: string;
}

/**
 * Resume: reconcile the working tree to the change set's DECIDED decisions
 * (projected server-side onto `FileChangeSet.decisions`), sourced entirely from
 * the pinned baseline/after refs — approved files are ensured at their "after"
 * bytes (uncommitted; normally already on disk from the review window, re-asserted
 * idempotently), rejected/undecided files are snapped back to baseline. Then
 * author RECONCILED with the post-reconcile approved snapshot and release the
 * refs. Because both sides are ref-sourced, the result is correct regardless of
 * the tree's current contents (idempotent under a Temporal retry or a tree reset).
 *
 * Scope precedence is runner-owned, most-specific-wins: the CHANGE_SET decision
 * (if any) seeds every file, then per-file FILE decisions override it.
 *
 * Enforcement ("what you approve is what applies"): before keeping an approved
 * file, the recomputed bytes must still hash to the reviewed digest. Any mismatch
 * authors a FileReviewFailure(HASH_MISMATCH) and applies NOTHING.
 *
 * Mutates `status.fileReviewEventStream` in place (authors RECONCILED / FAILED).
 */
export async function applyCaptureDecisions(opts: {
  readonly status: AgentExecutionStatus;
  readonly gitRoot: string;
  readonly executionId: string;
  readonly changeSet: FileChangeSet;
  readonly harnessId: string;
  readonly excludePaths?: readonly string[];
}): Promise<CaptureResumeResult> {
  const { status, gitRoot, executionId, changeSet, harnessId, excludePaths } = opts;

  const recomputed = await recomputeChangeSet(gitRoot, executionId);
  if (!recomputed) {
    return {
      isCaptureTurn: false,
      approvedPaths: [],
      rejectedPaths: [],
      hadReject: false,
      failed: false,
    };
  }

  const actionByChangeId = resolveDecisions(changeSet);

  const approved: GitCapturedChange[] = [];
  const rejected: GitCapturedChange[] = [];
  const approvedPaths: string[] = [];
  const rejectedPaths: string[] = [];
  const mismatches: string[] = [];
  let hadReject = false;

  for (const change of recomputed.changes) {
    const protoChange = changeSet.changes.find(
      (c) => c.id === `${changeSet.id}:${change.path}`,
    );
    const action = protoChange
      ? actionByChangeId.get(protoChange.id) ?? FileDecisionAction.UNSPECIFIED
      : FileDecisionAction.UNSPECIFIED;

    if (action === FileDecisionAction.APPROVE) {
      // Enforcement gate: the bytes we are about to keep must still match what
      // the reviewer approved. A divergence is never silently applied.
      if (protoChange && !digestMatches(change, protoChange)) {
        mismatches.push(change.path);
        continue;
      }
      approved.push(change);
      approvedPaths.push(change.path);
    } else {
      if (action === FileDecisionAction.REJECT) hadReject = true;
      rejected.push(change);
      rejectedPaths.push(change.path);
    }
  }

  if (mismatches.length > 0) {
    const detail = `on-disk content diverged from the approved digest for: ${mismatches.join(", ")}`;
    appendFileReviewEvents(status, executionId, [
      buildFailedEvent(
        changeSetContext(changeSet.id, harnessId),
        FileReviewFailureKind.HASH_MISMATCH,
        detail,
      ),
    ]);
    // Refuse to apply anything: a partial apply under a verification failure is
    // worse than none. The refs are left in place for diagnosis.
    return {
      isCaptureTurn: true,
      approvedPaths: [],
      rejectedPaths: [],
      hadReject,
      failed: true,
      failureDetail: detail,
    };
  }

  // Reconcile from the authoritative refs: approved files keep (re-assert) their
  // "after" bytes; rejected/undecided files snap back to baseline.
  await applyApprovedPaths(gitRoot, recomputed.afterTree, approved);
  await restoreToBaseline(gitRoot, recomputed.baselineTree, rejected);

  // Author RECONCILED carrying the exact post-reconcile (approved) snapshot.
  const approvedSnapshot = await snapshotApproved(gitRoot, executionId, excludePaths);
  appendFileReviewEvents(status, executionId, [
    buildReconciledEvent(
      changeSetContext(changeSet.id, harnessId),
      gitTreeSnapshotRef(approvedSnapshot.treeOid, approvedSnapshot.ref),
    ),
  ]);

  await dropCaptureRefs(gitRoot, executionId);

  return {
    isCaptureTurn: true,
    approvedPaths,
    rejectedPaths,
    hadReject,
    failed: false,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Resolve each file's effective decision (most-specific-wins, runner-owned):
 * seed every change with the CHANGE_SET decision (if present), then override per
 * file with FILE decisions. Returns change-id -> action.
 */
function resolveDecisions(
  changeSet: FileChangeSet,
): Map<string, FileDecisionAction> {
  const byChangeId = new Map<string, FileDecisionAction>();
  const changeSetDecision = changeSet.decisions.find(
    (d) => d.scope === FileDecisionScope.CHANGE_SET,
  );
  if (changeSetDecision) {
    for (const change of changeSet.changes) {
      byChangeId.set(change.id, changeSetDecision.action);
    }
  }
  for (const decision of changeSet.decisions) {
    if (decision.scope === FileDecisionScope.FILE && decision.fileChangeId) {
      byChangeId.set(decision.fileChangeId, decision.action);
    }
  }
  return byChangeId;
}

/**
 * Verify the recomputed bytes still hash to the digests the reviewer approved.
 * The "after" side is checked for CREATE/MODIFY (the bytes we keep); the "before"
 * side for MODIFY/DELETE (the baseline we restore from / remove).
 */
function digestMatches(
  gitChange: GitCapturedChange,
  protoChange: CapturedFileChange,
): boolean {
  if (gitChange.changeType !== FileChangeType.DELETE) {
    const after = inlineBody(gitChange.fileChange.after) ?? "";
    if (sha256Bytes(Buffer.from(after, "utf8")) !== protoChange.afterSha256) {
      return false;
    }
  }
  if (gitChange.changeType !== FileChangeType.CREATE) {
    const before = inlineBody(gitChange.fileChange.before) ?? "";
    if (sha256Bytes(Buffer.from(before, "utf8")) !== protoChange.beforeSha256) {
      return false;
    }
  }
  return true;
}

/** The shared change-set context every event for this turn carries. */
function changeSetContext(changeSetId: string, harnessId: string): ChangeSetContext {
  return {
    changeSetId,
    turnId: changeSetId,
    harnessId,
    timestamp: utcTimestamp(),
  };
}

/** Build a git-tree {@link SnapshotRef} for the ledger from a pinned ref. */
function gitTreeSnapshotRef(treeOid: string, ref: string): SnapshotRef {
  return create(SnapshotRefSchema, {
    kind: SnapshotKind.GIT_TREE_REF,
    git: create(GitTreeRefSchema, { treeOid, ref }),
  });
}

/** A FileContent's inline body, or undefined when absent (or offloaded). */
function inlineBody(fc: FileContent | undefined): string | undefined {
  if (!fc) return undefined;
  return fc.body.case === "inline" ? fc.body.value : undefined;
}

/** Map the git capture kind to the file-review {@link FileChangeKind}. */
function toFileChangeKind(changeType: FileChangeType): FileChangeKind {
  switch (changeType) {
    case FileChangeType.CREATE:
      return FileChangeKind.ADD;
    case FileChangeType.DELETE:
      return FileChangeKind.DELETE;
    default:
      return FileChangeKind.MODIFY;
  }
}

/**
 * Map a git-derived capture (`--no-renames`, so ADD/MODIFY/DELETE) to the
 * harness-agnostic producer input. The before/after bodies are the byte-exact
 * blobs git read; a binary side marks the file incomplete so the change set
 * cannot be approved as a complete diff.
 */
function toCapturedChangeInput(
  changeSetId: string,
  change: GitCapturedChange,
): CapturedChangeInput {
  const isCreate = change.changeType === FileChangeType.CREATE;
  const isDelete = change.changeType === FileChangeType.DELETE;
  const pathBefore = isCreate ? "" : change.path;
  const pathAfter = isDelete ? "" : change.path;
  const binary = Boolean(
    change.fileChange.before?.isBinary || change.fileChange.after?.isBinary,
  );
  return {
    id: `${changeSetId}:${pathAfter || pathBefore}`,
    pathBefore,
    pathAfter,
    kind: toFileChangeKind(change.changeType),
    captureClass: FileCaptureClass.GIT_TRACKED,
    before: inlineBody(change.fileChange.before),
    after: inlineBody(change.fileChange.after),
    diffComplete: !binary,
  };
}

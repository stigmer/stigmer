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
  CasManifestRefSchema,
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
  type GitSubstrateChange as GitCapturedChange,
} from "./git-substrate.js";
import type { ArtifactStorage } from "../artifact-storage.js";
import {
  applyCasApproved,
  loadCasManifest,
  restoreCasToBaseline,
  snapshotCasChangeSet,
  type BlobReader,
  type CasCapturedFile,
  type CasPathCapture,
  type CasSnapshotRef,
} from "./cas-substrate.js";

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
  /**
   * Ignored / non-git paths captured this turn (before/after bytes the harness
   * recorded at mutation time). When present, they are stored as content-
   * addressed CAS blobs and composed with the git-tracked changes into ONE
   * hybrid change set (design doc 11). Omit for a git-only turn — existing
   * callers are unaffected.
   */
  readonly casCaptures?: readonly CasPathCapture[];
  /** The CAS blob store; required when {@link casCaptures} is non-empty. */
  readonly storage?: ArtifactStorage;
  /**
   * Gitignored paths whose bytes are deliberately NOT captured — the DD-E secret
   * gate refused them. Each is authored as a content-less `DIFF_UNREVIEWABLE`
   * change entry (`diff_complete=false`, no before/after) so the change set is
   * PARTIAL_BLOCKED (approval blocked) and the path is honestly surfaced, while
   * its content never enters the ledger or storage. Never overlaps `casCaptures`.
   */
  readonly unreviewablePaths?: readonly string[];
}): Promise<readonly GitCapturedChange[]> {
  const {
    status, gitRoot, executionId, changeSetId, baselineTree, harnessId, excludePaths,
    casCaptures, storage, unreviewablePaths,
  } = opts;

  const { afterTree, changes: gitChanges } = await captureChangeSet(
    gitRoot,
    executionId,
    baselineTree,
    excludePaths,
  );

  // Capture the ignored / non-git deltas into CAS (content-addressed, deduped,
  // offloaded), if the harness supplied any this turn.
  let casFiles: readonly CasCapturedFile[] = [];
  let casRef: CasSnapshotRef | undefined;
  if (casCaptures && casCaptures.length > 0) {
    if (!storage) {
      throw new Error("captureCandidateToLedger: casCaptures requires an ArtifactStorage");
    }
    const snap = await snapshotCasChangeSet({ storage, executionId, changeSetId, captures: casCaptures });
    casFiles = snap.manifest.files;
    if (casFiles.length > 0) casRef = snap.ref;
  }

  const unreviewable = unreviewablePaths ?? [];

  // A turn that changed nothing (no tracked/ignored change and no blocked path)
  // authors no event.
  if (gitChanges.length === 0 && casFiles.length === 0 && unreviewable.length === 0) {
    return gitChanges;
  }

  // One combined change set: git-tracked (inline bodies) + CAS (blob refs) +
  // secret-blocked (content-less, DIFF_UNREVIEWABLE). The aggregate digest folds
  // all (buildCandidateCapturedEvent sorts by file digest), so the reviewed diff
  // and its identity span every substrate; any content-less entry forces
  // PARTIAL_BLOCKED so approval is blocked until the change is reviewable.
  const captured = [
    ...gitChanges.map((c) => buildCapturedFileChange(toCapturedChangeInput(changeSetId, c))),
    ...casFiles.map((f) => buildCapturedFileChange(casToCapturedChangeInput(changeSetId, f))),
    ...unreviewable.map((p) => buildCapturedFileChange(unreviewableChangeInput(changeSetId, p))),
  ];
  const snapshot = casRef
    ? hybridSnapshotRef(afterTree, captureRef(executionId), casRef)
    : gitTreeSnapshotRef(afterTree, captureRef(executionId));
  const event = buildCandidateCapturedEvent(
    changeSetContext(changeSetId, harnessId),
    snapshot,
    captured,
  );
  appendFileReviewEvents(status, executionId, [event]);
  return gitChanges;
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
  /**
   * The CAS blob store + reader, required to reconcile ignored / non-git files
   * captured this turn. Omit for a git-only harness/turn — the CAS branch is
   * then skipped entirely.
   */
  readonly storage?: ArtifactStorage;
  readonly readBlob?: BlobReader;
}): Promise<CaptureResumeResult> {
  const { status, gitRoot, executionId, changeSet, harnessId, excludePaths, storage, readBlob } = opts;

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

  // Reconcile git-tracked files from the authoritative refs: approved files keep
  // (re-assert) their "after" bytes; rejected/undecided files snap back to baseline.
  await applyApprovedPaths(gitRoot, recomputed.afterTree, approved);
  await restoreToBaseline(gitRoot, recomputed.baselineTree, rejected);

  // Reconcile CAS-captured (ignored / non-git) files from the durable manifest,
  // sourced entirely from artifact storage (the CAS analogue of the git refs).
  // Same decision map, keyed by the per-file change id, so the resolution rule is
  // identical across substrates. Absent manifest -> git-only turn -> no-op.
  if (storage && readBlob) {
    const manifest = await loadCasManifest({
      storage, readBlob, executionId, changeSetId: changeSet.id,
    });
    if (manifest) {
      const casApproved: CasCapturedFile[] = [];
      const casRejected: CasCapturedFile[] = [];
      for (const file of manifest.files) {
        const path = file.pathAfter || file.pathBefore;
        const action = actionByChangeId.get(`${changeSet.id}:${path}`) ?? FileDecisionAction.UNSPECIFIED;
        if (action === FileDecisionAction.APPROVE) {
          casApproved.push(file);
          approvedPaths.push(path);
        } else {
          if (action === FileDecisionAction.REJECT) hadReject = true;
          casRejected.push(file);
          rejectedPaths.push(path);
        }
      }
      await applyCasApproved({ readBlob, workspaceRoot: gitRoot, files: casApproved });
      await restoreCasToBaseline({ readBlob, workspaceRoot: gitRoot, files: casRejected });
    }
  }

  // Author RECONCILED carrying the exact post-reconcile (approved) git snapshot.
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

/**
 * Build a HYBRID {@link SnapshotRef} composing the git after-tree with the CAS
 * manifest — the shape for a turn that touched both git-tracked and ignored /
 * non-git paths (design doc 06 D3).
 */
function hybridSnapshotRef(treeOid: string, ref: string, cas: CasSnapshotRef): SnapshotRef {
  return create(SnapshotRefSchema, {
    kind: SnapshotKind.HYBRID,
    git: create(GitTreeRefSchema, { treeOid, ref }),
    cas: create(CasManifestRefSchema, {
      manifestDigest: cas.manifestDigest,
      artifactUri: cas.artifactUri,
    }),
  });
}

/**
 * Map a CAS-captured file to the harness-agnostic producer input. The before/
 * after bodies are carried as blob REFS (already offloaded to artifact storage
 * by the CAS substrate), never re-inlined — so the CANDIDATE event stays small
 * and the bytes are stored exactly once. Enforcement digests come from the blob
 * content addresses, identical in form to the git path.
 */
function casToCapturedChangeInput(
  changeSetId: string,
  file: CasCapturedFile,
): CapturedChangeInput {
  return {
    id: `${changeSetId}:${file.pathAfter || file.pathBefore}`,
    pathBefore: file.pathBefore,
    pathAfter: file.pathAfter,
    kind: file.kind,
    captureClass: file.captureClass,
    before: file.before
      ? {
          kind: "ref",
          sha256: file.before.sha256,
          storageKey: file.before.storageKey,
          sizeBytes: file.before.sizeBytes,
          isBinary: file.before.isBinary,
        }
      : undefined,
    after: file.after
      ? {
          kind: "ref",
          sha256: file.after.sha256,
          storageKey: file.after.storageKey,
          sizeBytes: file.after.sizeBytes,
          isBinary: file.after.isBinary,
        }
      : undefined,
    diffComplete: file.diffComplete,
  };
}

/**
 * Map a secret-blocked gitignored path to a content-less `DIFF_UNREVIEWABLE`
 * producer input (design doc 12). The bytes are deliberately never captured, so
 * both sides are absent (empty enforcement digests) and `diffComplete=false`
 * forces the change set to PARTIAL_BLOCKED — approval is blocked and the path is
 * surfaced honestly, while its CONTENT never enters the ledger or storage. Kind
 * is MODIFY: the write was blocked before it ran, so create-vs-modify is unknown
 * and irrelevant (nothing is ever applied or reconciled for this entry).
 */
function unreviewableChangeInput(changeSetId: string, path: string): CapturedChangeInput {
  return {
    id: `${changeSetId}:${path}`,
    pathBefore: path,
    pathAfter: path,
    kind: FileChangeKind.MODIFY,
    captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED,
    diffComplete: false,
  };
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

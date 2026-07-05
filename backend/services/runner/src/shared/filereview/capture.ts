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
  FileReviewBlockReason,
  FileReviewFailureKind,
  SnapshotKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
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
  TurnCommandProvenance,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { utcTimestamp } from "../status.js";
import {
  appendFileReviewEvents,
  buildBaselineCapturedEvent,
  buildCandidateCapturedEvent,
  buildCapturedFileChange,
  buildFailedEvent,
  buildReconciledEvent,
  contentSha256,
  type CapturedChangeInput,
  type ChangeSetContext,
} from "./events.js";
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
 * Whether a turn runs in apply-then-review CAPTURE mode (file edits flow and are
 * reviewed post-hoc) rather than the classic pre-write DENY-GATE. Shared by BOTH
 * harnesses (Cursor and deep-agent) so the capture-vs-deny-gate decision is made
 * one way everywhere — the single point where a workspace's substrate availability
 * decides the HITL model.
 *
 * Capture needs a primary workspace AND a substrate to capture into:
 *  - a git work tree captures tracked edits from the git diff (no storage needed);
 *  - a NON-git workspace captures every write via the path-scoped CAS substrate,
 *    which needs artifact storage to persist blobs.
 *
 * So a non-git workspace with NO artifact storage — or no workspace at all — has
 * no capture substrate and falls back to the deny-gate: the agent still runs, but
 * file writes gate pre-execution instead of flowing. In the Cursor harness that
 * fallback is also the ONLY branch that arms the resume-time exact-apply guarantee
 * (see execute-cursor/exact-apply.ts); the deep-agent harness re-applies an
 * approved write via LangGraph checkpoint replay and needs no exact-apply. Keeping
 * this the single, named, truth-table-tested decision pins exactly when the
 * no-storage deny-gate engages in either harness.
 */
export function deriveCaptureMode(
  primaryWorkspaceDir: string | undefined,
  gitWorkspace: boolean,
  hasArtifactStorage: boolean,
): boolean {
  return !!primaryWorkspaceDir && (gitWorkspace || hasArtifactStorage);
}

/**
 * Turn start: pin the pre-turn working tree behind the baseline ref and author
 * the BASELINE_CAPTURED event. The projection reads `turn_id`/`harness_id` ONLY
 * from this payload, so `turnId == changeSetId` (one turn = one change set) and
 * `harnessId` identifies the producer. Returns the baseline tree sha for the
 * turn-end diff. Appends onto `status.fileReviewEventStream`; the event rides the
 * next persist.
 *
 * `gitWorkspace=false` (a non-git workspace, DD-21 D2) has no whole-tree baseline
 * to pin — a file's pre-edit bytes are captured per-path by the CAS observer at
 * mutation time, and the reconcile sources them from the durable CAS manifest,
 * not this snapshot. The BASELINE event is still authored (it is the projection's
 * sole source for `turn_id`/`harness_id`), carrying a `CAS_MANIFEST` snapshot with
 * no manifest yet (the manifest is authored at candidate time). Returns "".
 */
export async function captureBaselineToLedger(opts: {
  readonly status: AgentExecutionStatus;
  readonly gitRoot: string;
  readonly executionId: string;
  readonly changeSetId: string;
  readonly harnessId: string;
  readonly excludePaths?: readonly string[];
  /** True (default) for a git work tree; false for a CAS-only non-git workspace. */
  readonly gitWorkspace?: boolean;
}): Promise<string> {
  const { status, gitRoot, executionId, changeSetId, harnessId, excludePaths } = opts;
  const gitWorkspace = opts.gitWorkspace ?? true;

  if (!gitWorkspace) {
    const event = buildBaselineCapturedEvent(
      changeSetContext(changeSetId, harnessId),
      casManifestSnapshotRef(),
    );
    appendFileReviewEvents(status, executionId, [event]);
    return "";
  }

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
  /**
   * Capture class stamped on the content-less DIFF_UNREVIEWABLE entries — the CAS
   * class of THIS turn's substrate: `GIT_IGNORED_CAPTURED` for a git work tree's
   * ignored paths, `NON_GIT_CAS` for a non-git workspace. Content-addressed
   * `casCaptures` carry their own per-item class; this only labels the blocked
   * (content-less) ones so a non-git blocked secret is not mislabeled "gitignored".
   * Defaults to `GIT_IGNORED_CAPTURED` (git callers are unaffected).
   */
  readonly unreviewableCaptureClass?: FileCaptureClass;
  /**
   * True (default) for a git work tree — git-tracked edits are diffed from the
   * pinned baseline/after trees and composed with any CAS captures. False for a
   * CAS-only non-git workspace (DD-21 D2): there is no git tree to diff, so the
   * change set is sourced ENTIRELY from `casCaptures` (+ `unreviewablePaths`) and
   * the snapshot is `CAS_MANIFEST`, not `GIT_TREE_REF`/`HYBRID`.
   */
  readonly gitWorkspace?: boolean;
  /**
   * The harness's approved-command turn facts (DD-28): present only when the
   * turn's sole mutation source was consented shell commands. Carried verbatim
   * on the CANDIDATE event for the backend to verify and — on success — author
   * the policy auto-keep decision. Omitted → the set reviews manually.
   */
  readonly commandProvenance?: TurnCommandProvenance;
}): Promise<readonly GitCapturedChange[]> {
  const {
    status, gitRoot, executionId, changeSetId, baselineTree, harnessId, excludePaths,
    casCaptures, storage, unreviewablePaths, commandProvenance,
  } = opts;
  const gitWorkspace = opts.gitWorkspace ?? true;
  const unreviewableCaptureClass =
    opts.unreviewableCaptureClass ?? FileCaptureClass.GIT_IGNORED_CAPTURED;

  // A non-git workspace has no tree to diff; git-tracked changes are empty and
  // the whole change set comes from the CAS captures below.
  const { afterTree, changes: gitChanges } = gitWorkspace
    ? await captureChangeSet(gitRoot, executionId, baselineTree, excludePaths)
    : { afterTree: "", changes: [] as readonly GitCapturedChange[] };

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
  // and its identity span every substrate. deriveDiffCompleteness then rolls the
  // per-file signals up three ways: any content-less (non-binary) entry forces
  // PARTIAL_BLOCKED; a set blocked only by binaries is BINARY_SUMMARY_ONLY
  // (keepable in one acknowledged action); else COMPLETE.
  const captured = [
    ...gitChanges.map((c) => buildCapturedFileChange(toCapturedChangeInput(changeSetId, c))),
    ...casFiles.map((f) => buildCapturedFileChange(casToCapturedChangeInput(changeSetId, f))),
    ...unreviewable.map((p) => buildCapturedFileChange(unreviewableChangeInput(changeSetId, p, unreviewableCaptureClass))),
  ];
  // Snapshot kind follows the substrate(s) that captured this turn: CAS-only for
  // a non-git workspace, HYBRID when a git turn also touched ignored/non-git
  // paths, else a plain git tree.
  const snapshot = !gitWorkspace
    ? casManifestSnapshotRef(casRef)
    : casRef
      ? hybridSnapshotRef(afterTree, captureRef(executionId), casRef)
      : gitTreeSnapshotRef(afterTree, captureRef(executionId));
  const event = buildCandidateCapturedEvent(
    changeSetContext(changeSetId, harnessId),
    snapshot,
    captured,
    commandProvenance,
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
   * The CAS blob reader, used to reconcile ignored / non-git (CAS) files from the
   * durable manifest — approved after-blobs re-written (hash-verified), rejected
   * files snapped back to their before-blobs. Whether the CAS branch runs at all
   * is decided by the change set's CANDIDATE snapshot (a git-only turn carries no
   * CAS ref), NOT by probing storage. Omit for a harness with no artifact storage;
   * a CAS/HYBRID change set then cannot be reconciled.
   *
   * `storage` is accepted so callers can pass the store they derived `readBlob`
   * from (via {@link casBlobReader}); the reconcile itself reads only through
   * `readBlob` and never probes `storage`.
   */
  readonly storage?: ArtifactStorage;
  readonly readBlob?: BlobReader;
  /**
   * True (default) for a git work tree; false for a CAS-only non-git workspace
   * (DD-21 D2). When false, git refs are never consulted — the reconcile is driven
   * entirely by the durable CAS manifest, and RECONCILED carries a `CAS_MANIFEST`
   * snapshot instead of a re-pinned git tree.
   */
  readonly gitWorkspace?: boolean;
}): Promise<CaptureResumeResult> {
  const { status, gitRoot, executionId, changeSet, harnessId, excludePaths, readBlob } = opts;
  const gitWorkspace = opts.gitWorkspace ?? true;

  // The two substrates are resolved up front and reconciled independently below:
  // git-tracked files from the pinned baseline/after refs, ignored/non-git files
  // from the durable CAS manifest. A resume is a capture turn iff at least one is
  // present; with neither this is an ordinary (non-capture) resume.
  //
  // Whether this turn captured any CAS (ignored / non-git) files is a fact the
  // ledger already records: the change set's CANDIDATE snapshot carries a CAS
  // manifest ref for a CAS/HYBRID turn and none for a git-only turn. We branch on
  // that ledger fact — NOT on probing artifact storage. A git-only turn writes no
  // manifest, and asking storage "does the manifest exist?" is both redundant and
  // unsafe: a presigned/proxy backend answers true for any key, which turned a
  // git-only reconcile into a doomed manifest download and a 404 crash. Single
  // source of truth: derive the substrate from the ledger, never from storage.
  const recomputed = gitWorkspace ? await recomputeChangeSet(gitRoot, executionId) : undefined;
  const casRef = candidateCasRef(changeSet);
  if (casRef && !readBlob) {
    // The ledger says CAS files were captured, but this caller cannot read blobs
    // back. Skipping would leave those files applied with their decisions
    // unenforced — a silent partial reconcile — so refuse loudly instead.
    throw new Error(
      `applyCaptureDecisions: change set '${changeSet.id}' captured CAS files ` +
      `(manifest '${casRef.artifactUri}') but no blob reader was provided`,
    );
  }
  const manifest = casRef && readBlob ? await loadCasManifest({ readBlob, ref: casRef }) : undefined;
  if (!recomputed && !manifest) {
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

  for (const change of recomputed?.changes ?? []) {
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
  if (recomputed) {
    await applyApprovedPaths(gitRoot, recomputed.afterTree, approved);
    await restoreToBaseline(gitRoot, recomputed.baselineTree, rejected);
  }

  // Reconcile CAS-captured (ignored / non-git) files from the durable manifest,
  // sourced entirely from artifact storage (the CAS analogue of the git refs).
  // Same decision map, keyed by the per-file change id, so the resolution rule is
  // identical across substrates. For a non-git workspace this is the ONLY reconcile.
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
    await applyCasApproved({ readBlob: readBlob!, workspaceRoot: gitRoot, files: casApproved });
    await restoreCasToBaseline({ readBlob: readBlob!, workspaceRoot: gitRoot, files: casRejected });
  }

  // Author RECONCILED carrying the exact post-reconcile snapshot. A git turn
  // re-pins the approved working tree; a CAS-only turn references the durable
  // manifest (the reconciled state is fully derivable from manifest + decisions,
  // and there is no tree to pin).
  let approvedSnapshot: SnapshotRef;
  if (recomputed) {
    const snap = await snapshotApproved(gitRoot, executionId, excludePaths);
    approvedSnapshot = gitTreeSnapshotRef(snap.treeOid, snap.ref);
  } else {
    approvedSnapshot = casManifestSnapshotRef(candidateCasRef(changeSet));
  }
  appendFileReviewEvents(status, executionId, [
    buildReconciledEvent(changeSetContext(changeSet.id, harnessId), approvedSnapshot),
  ]);

  if (recomputed) await dropCaptureRefs(gitRoot, executionId);

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
 * Verify the recomputed content still hashes to the digests the reviewer
 * approved. The "after" side is checked for CREATE/MODIFY (the bytes we keep);
 * the "before" side for MODIFY/DELETE (the baseline we restore from / remove).
 *
 * The sha is taken via the shared {@link contentSha256} over the recomputed
 * {@link CapturedContent} — the SAME function that produced the persisted
 * `before_sha256`/`after_sha256` at capture — so it is byte-true for binary and
 * text alike and matches by construction when the underlying bytes are unchanged.
 * (Re-hashing an inline body string here would be lossy for binaries and would
 * spuriously fail an approved binary, since a binary side carries no body.)
 */
function digestMatches(
  gitChange: GitCapturedChange,
  protoChange: CapturedFileChange,
): boolean {
  if (gitChange.changeType !== FileChangeType.DELETE) {
    if (!gitChange.after || contentSha256(gitChange.after) !== protoChange.afterSha256) {
      return false;
    }
  }
  if (gitChange.changeType !== FileChangeType.CREATE) {
    if (!gitChange.before || contentSha256(gitChange.before) !== protoChange.beforeSha256) {
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
 * Build a CAS-only {@link SnapshotRef} — the shape for a non-git workspace, whose
 * every captured path lives in the content-addressed manifest and no git tree
 * exists (DD-21 D2). `cas` is absent for the BASELINE placeholder (the manifest is
 * authored at candidate time); present for CANDIDATE/RECONCILED once it exists.
 */
function casManifestSnapshotRef(cas?: CasSnapshotRef): SnapshotRef {
  return create(SnapshotRefSchema, {
    kind: SnapshotKind.CAS_MANIFEST,
    cas: cas
      ? create(CasManifestRefSchema, {
          manifestDigest: cas.manifestDigest,
          artifactUri: cas.artifactUri,
        })
      : undefined,
  });
}

/**
 * The CAS manifest reference a change set was captured against, read from its
 * CANDIDATE snapshot — the durable record a CAS-only RECONCILED event points back
 * at (the reconciled state is manifest + decisions; there is no tree to re-pin).
 * Undefined when the candidate carried no CAS manifest.
 */
function candidateCasRef(changeSet: FileChangeSet): CasSnapshotRef | undefined {
  const cas = changeSet.candidateSnapshot?.cas;
  return cas ? { manifestDigest: cas.manifestDigest, artifactUri: cas.artifactUri } : undefined;
}

/**
 * Map a CAS-captured file to the harness-agnostic producer input. The before/
 * after bodies are carried as blob REFS (already offloaded to artifact storage
 * by the CAS substrate), never re-inlined — so the CANDIDATE event stays small
 * and the bytes are stored exactly once. Enforcement digests come from the blob
 * content addresses, identical in form to the git path. The display line counts
 * ride along explicitly — a ref side has no inline text for the producer to
 * count, so the substrate's capture-time counts are the only honest source.
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
    lineCounts: file.lineCounts,
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
 * Map a secret-blocked gitignored path to a content-less producer input (design
 * doc 12, DD-E). The bytes are deliberately never captured, so both sides are
 * absent (empty enforcement digests) and `diffComplete=false`. Being non-binary
 * incomplete with no keepable bytes, it forces the change set to PARTIAL_BLOCKED
 * (never BINARY_SUMMARY_ONLY) — approval is blocked and the path is surfaced
 * honestly, while its CONTENT never enters the ledger or storage. `blockedReason` records
 * the honest cause (SECRET_WITHHELD) so the review UI can say *why* rather than
 * showing a cause-agnostic "unavailable" (doc 15). Kind is MODIFY: the write was
 * blocked before it ran, so create-vs-modify is unknown and irrelevant (nothing
 * is ever applied or reconciled for this entry). `captureClass` is the turn's CAS
 * substrate class (GIT_IGNORED_CAPTURED | NON_GIT_CAS) so the blocked path is
 * labeled with its true provenance.
 */
function unreviewableChangeInput(
  changeSetId: string,
  path: string,
  captureClass: FileCaptureClass,
): CapturedChangeInput {
  return {
    id: `${changeSetId}:${path}`,
    pathBefore: path,
    pathAfter: path,
    kind: FileChangeKind.MODIFY,
    captureClass,
    diffComplete: false,
    blockedReason: FileReviewBlockReason.SECRET_WITHHELD,
  };
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
 * harness-agnostic producer input. The before/after content is the
 * {@link CapturedContent} the substrate derived from the exact blob bytes; a
 * binary side (carried as a content address, no body) marks the file incomplete
 * so the change set cannot be approved as a complete text diff.
 */
function toCapturedChangeInput(
  changeSetId: string,
  change: GitCapturedChange,
): CapturedChangeInput {
  const isCreate = change.changeType === FileChangeType.CREATE;
  const isDelete = change.changeType === FileChangeType.DELETE;
  const pathBefore = isCreate ? "" : change.path;
  const pathAfter = isDelete ? "" : change.path;
  const binary = change.before?.kind === "binary" || change.after?.kind === "binary";
  return {
    id: `${changeSetId}:${pathAfter || pathBefore}`,
    pathBefore,
    pathAfter,
    kind: toFileChangeKind(change.changeType),
    captureClass: FileCaptureClass.GIT_TRACKED,
    before: change.before,
    after: change.after,
    diffComplete: !binary,
  };
}

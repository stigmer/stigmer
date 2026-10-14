/**
 * Harness-agnostic capture-mode turn orchestration for the apply-then-review
 * HITL subsystem. This is the glue between the git snapshot/restore substrate
 * ({@link ./git-substrate.js}) and the file-review ledger ({@link ./events.js}):
 * it turns "the agent edited files freely this turn" into the append-only
 * `file_review` ledger the run's file record is read from
 * (`RunStatus.file_changes`, `record.ts`), and after the turn puts back the
 * files a person undid ({@link undoChangeSet}).
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
 * `${changeSetId}:${pathAfter||pathBefore}` so an undo can map a per-file
 * decision back to its path without depending on any other identity.
 */

import { create } from "@bufbuild/protobuf";
import {
  FileCaptureClass,
  FileChangeKind,
  FileReviewBlockReason,
  SnapshotKind,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import {
  CasManifestRefSchema,
  GitTreeRefSchema,
  SnapshotRefSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import type {
  CapturedFileChange,
  FileChangeSet,
  SnapshotRef,
  TurnCommandProvenance,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { utcTimestamp } from "../status.js";
import {
  appendFileReviewEvents,
  buildBaselineCapturedEvent,
  buildCandidateCapturedEvent,
  buildCapturedFileChange,
  changeSetIdParts,
  type LedgerHolder,
  contentSha256,
  type CapturedChangeInput,
  type ChangeSetContext,
} from "./events.js";
import {
  baselineRef,
  captureChangeSet,
  captureRef,
  recomputeChangeSet,
  restoreToBaseline,
  snapshotBaseline,
  type GitSubstrateChange as GitCapturedChange,
} from "./git-substrate.js";
import type { ArtifactStorage } from "../artifact-storage.js";
import {
  loadCasManifest,
  restoreCasToBaseline,
  snapshotCasChangeSet,
  type BlobReader,
  type CasCapturedFile,
  type CasPathCapture,
  type CasSnapshotRef,
} from "./cas-substrate.js";
import { isSecretLikePath } from "./secret-paths.js";
import { FileChangeType } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

/**
 * Whether a workspace CAN capture a turn's file edits: the substrate half of
 * {@link deriveCaptureMode}, and on its own the input to the secret-path rule
 * (a secret-like write flows only where the git substrate would hold it;
 * `secret-paths.ts`). Shared by BOTH harnesses so the question is answered
 * one way everywhere.
 *
 * Capture needs a primary workspace AND a substrate to capture into:
 *  - a git work tree captures tracked edits from the git diff (no storage needed);
 *  - a NON-git workspace captures every write via the path-scoped CAS substrate,
 *    which needs artifact storage to persist blobs.
 *
 * So a non-git workspace with NO artifact storage — or no workspace at all — has
 * no capture substrate.
 */
export function deriveCaptureSubstrate(
  primaryWorkspaceDir: string | undefined,
  gitWorkspace: boolean,
  hasArtifactStorage: boolean,
): boolean {
  return !!primaryWorkspaceDir && (gitWorkspace || hasArtifactStorage);
}

/**
 * Whether a turn runs in apply-then-review CAPTURE mode: its file edits flow
 * and are offered for review after the turn, Keep or Undo. Two facts must
 * both hold:
 *
 *  - `review`: the conversation asked for review (`SessionSpec.file_review`),
 *    or the run is a plugin-eval try, whose graders read the captured sets
 *    whatever the switch says. Off by default.
 *  - the workspace has a capture substrate ({@link deriveCaptureSubstrate}).
 *
 * With review off a built-in write or delete simply flows and nothing is
 * captured. With review on and no substrate, file writes ask before they run
 * (the classic deny-gate): in the Cursor harness that fallback is also the
 * ONLY branch that arms the resume-time exact-apply guarantee (see
 * shared/exact-apply.ts); the deep-agent harness re-applies an approved write
 * via LangGraph checkpoint replay and needs no exact-apply. Keeping this the
 * single, named, truth-table-tested decision pins exactly when capture and
 * the deny-gate engage in either harness.
 */
export function deriveCaptureMode(
  primaryWorkspaceDir: string | undefined,
  gitWorkspace: boolean,
  hasArtifactStorage: boolean,
  review: boolean,
): boolean {
  return review && deriveCaptureSubstrate(primaryWorkspaceDir, gitWorkspace, hasArtifactStorage);
}

/**
 * Turn start: pin the pre-turn working tree behind the baseline ref and author
 * the BASELINE_CAPTURED event. The projection reads `turn_id`/`harness_id` ONLY
 * from this payload, so `turnId == changeSetId` (one turn = one change set) and
 * `harnessId` identifies the producer. Returns the baseline tree sha for the
 * turn-end diff. Appends onto the turn's ledger (`rows.fileReviewEventStream`);
 * the next persist reads it into the run's file record.
 *
 * `gitWorkspace=false` (a non-git workspace) has no whole-tree baseline
 * to pin — a file's pre-edit bytes are captured per-path by the CAS observer at
 * mutation time, and the reconcile sources them from the durable CAS manifest,
 * not this snapshot. The BASELINE event is still authored (it is the projection's
 * sole source for `turn_id`/`harness_id`), carrying a `CAS_MANIFEST` snapshot with
 * no manifest yet (the manifest is authored at candidate time). Returns "".
 */
export async function captureBaselineToLedger(opts: {
  readonly rows: LedgerHolder;
  readonly gitRoot: string;
  readonly executionId: string;
  readonly changeSetId: string;
  readonly harnessId: string;
  readonly excludePaths?: readonly string[];
  /** True (default) for a git work tree; false for a CAS-only non-git workspace. */
  readonly gitWorkspace?: boolean;
}): Promise<string> {
  const { rows, gitRoot, executionId, changeSetId, harnessId, excludePaths } = opts;
  const gitWorkspace = opts.gitWorkspace ?? true;

  if (!gitWorkspace) {
    const event = buildBaselineCapturedEvent(
      changeSetContext(changeSetId, harnessId),
      casManifestSnapshotRef(),
    );
    appendFileReviewEvents(rows, executionId, [event]);
    return "";
  }

  const baselineTree = await snapshotBaseline(gitRoot, executionId, excludePaths);
  const event = buildBaselineCapturedEvent(
    changeSetContext(changeSetId, harnessId),
    gitTreeSnapshotRef(baselineTree, baselineRef(executionId)),
  );
  appendFileReviewEvents(rows, executionId, [event]);
  return baselineTree;
}

/**
 * Turn end: capture the change set, LEAVE the working tree in its applied
 * ("after") state (the user reviews the real change; nothing is committed and
 * the turn ends normally), and author the CANDIDATE_CAPTURED event. The pinned
 * baseline/after refs are the authoritative source for an undo after the turn
 * ({@link undoChangeSet}).
 *
 * Presentation (hiding the harness's flowed transcript rows so the change set
 * is the single review surface) is the harness adapter's concern, not this seam's.
 * Returns the captured changes. No-op authoring when the turn changed nothing.
 */
export async function captureCandidateToLedger(opts: {
  readonly rows: LedgerHolder;
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
   * hybrid change set. Omit for a git-only turn — existing
   * callers are unaffected.
   */
  readonly casCaptures?: readonly CasPathCapture[];
  /** The CAS blob store; required when {@link casCaptures} is non-empty. */
  readonly storage?: ArtifactStorage;
  /**
   * Gitignored paths whose bytes are deliberately NOT captured — the secret
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
   * CAS-only non-git workspace: there is no git tree to diff, so the
   * change set is sourced ENTIRELY from `casCaptures` (+ `unreviewablePaths`) and
   * the snapshot is `CAS_MANIFEST`, not `GIT_TREE_REF`/`HYBRID`.
   */
  readonly gitWorkspace?: boolean;
  /**
   * The harness's approved-command turn facts: present only when the
   * turn's sole mutation source was consented shell commands. Carried verbatim
   * on the CANDIDATE event for the backend to verify and — on success — author
   * the policy auto-keep decision. Omitted → the set reviews manually.
   */
  readonly commandProvenance?: TurnCommandProvenance;
}): Promise<readonly GitCapturedChange[]> {
  const {
    rows, gitRoot, executionId, changeSetId, baselineTree, harnessId, excludePaths,
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

  // Secret handling is three-way across the substrates, and this is the last of
  // the three (the other two happen upstream at the harness gate):
  //   1. A gitignored secret WRITE never flows — hard-blocked at the gate /
  //      deny-gate. It arrives here only as a path in
  //      `unreviewablePaths` (recorded by the gate), authored content-less below.
  //   2. A gitignored secret that flowed under the global bypass is withheld from
  //      CAS by `partitionIgnoredPathsBySecret` (secret-paths.ts), so its bytes
  //      never reach `casCaptures`.
  //   3. A git-TRACKED secret DID flow (the capture-mode gate allows tracked
  //      mutations with no secret check) and is present in `gitChanges` with real
  //      bytes. We split it out here and author it content-less, so its content
  //      never reaches the ledger. Unlike a gitignored secret it HAS a reversible
  //      substrate (the git refs), so it is withheld-and-reverted rather than
  //      never-applied — same never-persisted guarantee, appropriate mechanism.
  const { safe: safeGitChanges, secret: secretGitChanges } =
    partitionGitChangesBySecret(gitChanges);

  // A turn that changed nothing (no tracked/ignored change and no blocked path)
  // authors no event. A secret-only tracked turn is NOT a no-op — its file is in
  // `gitChanges`, so the guard below is false and it authors a blocked entry.
  if (gitChanges.length === 0 && casFiles.length === 0 && unreviewable.length === 0) {
    return gitChanges;
  }

  // One combined change set: git-tracked (inline bodies) + git-tracked-secret
  // (content-less) + CAS (blob refs) + gitignored-secret-blocked (content-less).
  // The aggregate digest folds all (buildCandidateCapturedEvent sorts by file
  // digest), so the reviewed diff and its identity span every substrate.
  // deriveDiffCompleteness then rolls the per-file signals up three ways: any
  // content-less (non-binary) entry forces PARTIAL_BLOCKED; a set blocked only by
  // binaries is BINARY_SUMMARY_ONLY (keepable in one acknowledged action); else
  // COMPLETE.
  const captured = [
    ...safeGitChanges.map((c) => buildCapturedFileChange(toCapturedChangeInput(changeSetId, c))),
    ...secretGitChanges.map((c) => buildCapturedFileChange(trackedSecretChangeInput(changeSetId, c))),
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
  appendFileReviewEvents(rows, executionId, [event]);
  return gitChanges;
}

/** Why an undo put nothing back, as `stigmer.file_review.reconciled` names it. */
export type UndoFailure = "hash_mismatch" | "reconcile_failed";

/** The undo of one change set after its turn: the paths put back, or why none were. */
export interface UndoOutcome {
  readonly changeSetId: string;
  /** Workspace-relative paths restored to their pre-turn bytes; empty on a failure. */
  readonly undonePaths: readonly string[];
  /** `""` when the files were put back. */
  readonly failure: UndoFailure | "";
  /** What failed, for a person; `""` when nothing did. */
  readonly failureDetail: string;
}

/**
 * One decision on a change set, as the session's `stigmer.file_review.decided`
 * event states it: the server writes it, the undo reads it from the log.
 */
export interface LoggedFileDecision {
  /** `change_set` (every file of the set) or `file` (the one file). */
  readonly scope: string;
  /** The file decided, for scope `file`; "" otherwise. */
  readonly fileChangeId: string;
  /** `keep` or `undo`. */
  readonly action: string;
}

/**
 * Put back the files a person undid in one change set, after its turn: every
 * file whose effective decision is `undo` (a change-set decision seeds every
 * file, a file decision overrides it, most specific wins; among decisions of
 * one scope the later wins) returns to its pre-turn bytes. Kept and
 * undecided files are left exactly as they are: review never holds a turn,
 * so an undecided file is one nobody objected to. The set is read from its
 * run's file record, the decisions from the session's log, oldest first.
 *
 * The sources are the ones capture pinned, never the live tree: a git-tracked
 * file from the change set's run's baseline and capture refs
 * ({@link recomputeChangeSet}, keyed by that run's id), a gitignored or non-git
 * file from the CAS manifest the candidate recorded. So the restore is correct
 * whatever the tree holds now, and idempotent under a retry.
 *
 * The hash guard ("what you reviewed is what is undone"): before anything is
 * written, each file being undone must still match, on both sides, the digests
 * the person reviewed. A git file is checked as the keep path always was
 * ({@link digestMatches}); a CAS file by its manifest's blob addresses. A
 * secret-withheld entry carries no digests (its bytes were never recorded) and
 * is undone from the refs alone. Any mismatch answers `hash_mismatch` and
 * restores NOTHING; refs that are gone, a manifest that cannot be read, or a
 * restore that throws answer `reconcile_failed`.
 *
 * Writes nothing to any ledger: the outcome is the caller's to record, as the
 * session's `stigmer.file_review.reconciled` event. Leaves the refs in place:
 * the next message turn drops them once the change set's window has closed
 * (`git-substrate.ts` `dropCaptureRefs`).
 */
export async function undoChangeSet(opts: {
  readonly gitRoot: string;
  readonly changeSet: FileChangeSet;
  /** The set's decisions from the session's log, oldest first. */
  readonly decisions: readonly LoggedFileDecision[];
  /** False for a CAS-only non-git workspace: git refs are never consulted. */
  readonly gitWorkspace: boolean;
  /** Reads a CAS blob back; absent when the runner has no artifact storage. */
  readonly readBlob?: BlobReader;
}): Promise<UndoOutcome> {
  const { gitRoot, changeSet, decisions, gitWorkspace, readBlob } = opts;
  const failed = (failure: UndoFailure, failureDetail: string): UndoOutcome => ({
    changeSetId: changeSet.id,
    undonePaths: [],
    failure,
    failureDetail,
  });

  const actionByChangeId = resolveDecisions(changeSet, decisions);
  const undone = changeSet.changes.filter((c) => actionByChangeId.get(c.id) === "undo");
  if (undone.length === 0) return { changeSetId: changeSet.id, undonePaths: [], failure: "", failureDetail: "" };
  const undoneById = new Map(undone.map((c) => [c.id, c]));

  try {
    // Git-tracked files, from the change set's run's pinned refs.
    const runId = changeSetIdParts(changeSet.id).runId;
    const gitUndone = undone.filter((c) => c.captureClass === FileCaptureClass.GIT_TRACKED);
    const recomputed = gitWorkspace && gitUndone.length > 0 ? await recomputeChangeSet(gitRoot, runId) : undefined;
    if (gitUndone.length > 0 && recomputed === undefined) {
      return failed("reconcile_failed", `the captured state of the turn is gone from the workspace, so ${gitUndone.map(pathOf).join(", ")} could not be put back`);
    }
    const gitRestore: GitCapturedChange[] = [];
    const mismatches: string[] = [];
    const seen = new Set<string>();
    for (const change of recomputed?.changes ?? []) {
      const proto = undoneById.get(`${changeSet.id}:${change.path}`);
      if (proto === undefined) continue;
      seen.add(proto.id);
      if (!isSecretWithheld(proto) && !digestMatches(change, proto)) {
        mismatches.push(change.path);
        continue;
      }
      gitRestore.push(change);
    }

    // CAS files (gitignored or non-git), from the manifest the candidate recorded.
    const casRef = candidateCasRef(changeSet);
    const casUndone = undone.filter((c) => c.captureClass !== FileCaptureClass.GIT_TRACKED && !isSecretWithheld(c));
    const casRestore: CasCapturedFile[] = [];
    if (casRef && casUndone.length > 0) {
      if (!readBlob) {
        return failed("reconcile_failed", `no artifact storage to read back ${casUndone.map(pathOf).join(", ")}`);
      }
      const manifest = await loadCasManifest({ readBlob, ref: casRef });
      for (const file of manifest.files) {
        const path = file.pathAfter || file.pathBefore;
        const proto = undoneById.get(`${changeSet.id}:${path}`);
        if (proto === undefined) continue;
        seen.add(proto.id);
        if ((file.before?.sha256 ?? "") !== proto.beforeSha256 || (file.after?.sha256 ?? "") !== proto.afterSha256) {
          mismatches.push(path);
          continue;
        }
        casRestore.push(file);
      }
    }

    // A file being undone that its source no longer holds was captured
    // differently from what was reviewed.
    for (const change of [...gitUndone, ...casUndone]) {
      if (!seen.has(change.id)) mismatches.push(pathOf(change));
    }
    if (mismatches.length > 0) {
      // Restore nothing: a partial undo under a verification failure is worse
      // than none. The refs stay for diagnosis.
      return failed("hash_mismatch", `the captured content no longer matches what was reviewed for: ${mismatches.join(", ")}`);
    }

    if (recomputed && gitRestore.length > 0) await restoreToBaseline(gitRoot, recomputed.baselineTree, gitRestore);
    if (casRestore.length > 0) await restoreCasToBaseline({ readBlob: readBlob!, workspaceRoot: gitRoot, files: casRestore });
    return {
      changeSetId: changeSet.id,
      undonePaths: [...gitRestore.map((c) => c.path), ...casRestore.map((f) => f.pathAfter || f.pathBefore)],
      failure: "",
      failureDetail: "",
    };
  } catch (err) {
    return failed("reconcile_failed", err instanceof Error ? err.message : String(err));
  }
}

/** A change's workspace path, as a person reads it. */
function pathOf(change: CapturedFileChange): string {
  return change.pathAfter || change.pathBefore;
}

/** A content-less entry whose bytes were never recorded (a secret-like path): no digest to check. */
function isSecretWithheld(change: CapturedFileChange): boolean {
  return change.blockedReason === FileReviewBlockReason.SECRET_WITHHELD;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Resolve each file's effective decision (most-specific-wins, runner-owned):
 * seed every change with the change-set decisions in order, then override
 * per file with the file decisions in order. Returns change-id -> action
 * (`keep` or `undo`).
 */
export function resolveDecisions(
  changeSet: Pick<FileChangeSet, "changes">,
  decisions: readonly LoggedFileDecision[],
): Map<string, string> {
  const byChangeId = new Map<string, string>();
  for (const decision of decisions) {
    if (decision.scope !== "change_set") continue;
    for (const change of changeSet.changes) byChangeId.set(change.id, decision.action);
  }
  for (const decision of decisions) {
    if (decision.scope === "file" && decision.fileChangeId !== "") byChangeId.set(decision.fileChangeId, decision.action);
  }
  return byChangeId;
}

/**
 * Verify the recomputed content still hashes to the digests the reviewer saw.
 * The "after" side is checked for CREATE/MODIFY (the bytes on the tree); the
 * "before" side for MODIFY/DELETE (the baseline an undo restores).
 *
 * The sha is taken via the shared {@link contentSha256} over the recomputed
 * {@link CapturedContent} — the SAME function that produced the persisted
 * `before_sha256`/`after_sha256` at capture — so it is byte-true for binary and
 * text alike and matches by construction when the underlying bytes are unchanged.
 * (Re-hashing an inline body string here would be lossy for binaries and would
 * spuriously fail a binary, since a binary side carries no body.)
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
 * non-git paths.
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
 * exists. `cas` is absent for the BASELINE placeholder (the manifest is
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
 * The single content-less `SECRET_WITHHELD` producer input — the one shape every
 * secret-blocked change (gitignored OR git-tracked) is authored with, so the two
 * producers can never drift (a divergence in `diffComplete`/`blockedReason` would
 * make the backend gate treat one kind of secret differently from the other).
 *
 * Both sides are absent (empty enforcement digests) and `diffComplete=false`.
 * Being non-binary incomplete with no keepable bytes, it forces the change set to
 * PARTIAL_BLOCKED (never BINARY_SUMMARY_ONLY) — approval is blocked and the path
 * is surfaced honestly, while its CONTENT never enters the ledger or storage.
 * `blockedReason=SECRET_WITHHELD` records the honest cause so the review UI can say
 * *why* rather than a cause-agnostic "unavailable". Callers supply the
 * id / paths / kind / captureClass so each producer keeps its own honest identity.
 */
function secretWithheldChangeInput(
  id: string,
  pathBefore: string,
  pathAfter: string,
  kind: FileChangeKind,
  captureClass: FileCaptureClass,
): CapturedChangeInput {
  return {
    id,
    pathBefore,
    pathAfter,
    kind,
    captureClass,
    diffComplete: false,
    blockedReason: FileReviewBlockReason.SECRET_WITHHELD,
  };
}

/**
 * Map a secret-blocked GITIGNORED path (the write never flowed — hard-blocked at
 * the harness gate) to a content-less entry. The write was
 * blocked before it ran, so create-vs-modify is unknown and irrelevant (nothing
 * is ever applied or reconciled for this entry) — kind is MODIFY. `captureClass`
 * is the turn's CAS substrate class (GIT_IGNORED_CAPTURED | NON_GIT_CAS).
 */
function unreviewableChangeInput(
  changeSetId: string,
  path: string,
  captureClass: FileCaptureClass,
): CapturedChangeInput {
  return secretWithheldChangeInput(
    `${changeSetId}:${path}`,
    path,
    path,
    FileChangeKind.MODIFY,
    captureClass,
  );
}

/**
 * Map a secret-like GIT-TRACKED change to a content-less entry. Unlike a
 * gitignored secret, a tracked secret write actually FLOWED (the
 * capture-mode gate allows tracked mutations), so it is present in the git diff
 * with real bytes — which must never be persisted into the ledger. We author it
 * content-less here so its CONTENT never reaches the ledger / Temporal history /
 * storage, while the honest kind + paths (a CREATE/MODIFY/DELETE, mirroring
 * {@link toCapturedChangeInput}'s id/path derivation so the resume reconcile
 * lookup matches) and `GIT_TRACKED` provenance are preserved. It is discard-only
 * (PARTIAL_BLOCKED): on resume it can only be rejected, and the git substrate
 * reverts it byte-exact from the baseline ref (the reversible substrate a
 * gitignored secret lacks — so "withhold + revert" upholds never-persisted here
 * without the gate hard-block). A DELETE is handled here too: the git diff
 * resurrects the deleted file's baseline (secret) bytes as the `before` side, a
 * leak only this seam can withhold (the gate sees no content for a delete).
 */
function trackedSecretChangeInput(
  changeSetId: string,
  change: GitCapturedChange,
): CapturedChangeInput {
  const isCreate = change.changeType === FileChangeType.CREATE;
  const isDelete = change.changeType === FileChangeType.DELETE;
  const pathBefore = isCreate ? "" : change.path;
  const pathAfter = isDelete ? "" : change.path;
  return secretWithheldChangeInput(
    `${changeSetId}:${pathAfter || pathBefore}`,
    pathBefore,
    pathAfter,
    toFileChangeKind(change.changeType),
    FileCaptureClass.GIT_TRACKED,
  );
}

/**
 * Split a turn's git-tracked changes by the secret gate: a secret-like tracked
 * path (a committed `credentials.json`, `.env.example`, `*.tfvars`, ...) goes to
 * `secret` (authored content-less via {@link trackedSecretChangeInput}); every
 * other tracked change stays in `safe` (its diff is captured normally). Pure and
 * exported for direct unit testing. Keyed on the same {@link isSecretLikePath}
 * classifier the CAS/gitignored path uses ({@link partitionIgnoredPathsBySecret}
 * in secret-paths.ts), so a path is classified identically everywhere. NOTE: the
 * classifier is path-based, so a rename to an innocuous name defeats
 * it — an intentional, cross-substrate limitation, not introduced here.
 */
export function partitionGitChangesBySecret(changes: readonly GitCapturedChange[]): {
  readonly safe: readonly GitCapturedChange[];
  readonly secret: readonly GitCapturedChange[];
} {
  const safe: GitCapturedChange[] = [];
  const secret: GitCapturedChange[] = [];
  for (const change of changes) {
    if (isSecretLikePath(change.path)) secret.push(change);
    else safe.push(change);
  }
  return { safe, secret };
}

/** Map the git capture kind to the file-review {@link FileChangeKind}. */
export function toFileChangeKind(changeType: FileChangeType): FileChangeKind {
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

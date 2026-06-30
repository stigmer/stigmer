/**
 * Capture-mode turn orchestration for the Cursor harness (git workspaces).
 *
 * This is the glue between the git snapshot/restore substrate (shadow-capture.ts)
 * and the file-review ledger: it turns "the agent edited files freely this turn"
 * into the append-only `file_review` events the server folds into
 * `file_change_sets` (the single review surface), and on resume reconciles the
 * tree to the user's decisions.
 *
 * It owns the two turn-boundary transforms and nothing else:
 *  - {@link captureBaselineToLedger} (turn start): pin the pre-turn tree and
 *    author the BASELINE_CAPTURED event so the projection can materialize the
 *    change set before any candidate exists.
 *  - {@link captureTurnToLedger} (turn end): capture the change set, LEAVE the
 *    working tree in its applied state (Cursor parity — nothing is committed and
 *    the next turn is blocked until approval), hide the streamed file-edit rows
 *    (the ledger is now the single review surface), and author the
 *    CANDIDATE_CAPTURED event carrying the authoritative git-derived diff.
 *  - {@link applyCaptureDecisions} (resume): recompute the change set from the
 *    pinned refs and reconcile the tree to the decisions — keep approved files
 *    (re-asserted from the "after" ref), snap rejected/undecided files back to
 *    baseline — then drop the refs.
 *
 * Identity: the change set id is `${executionId}:${turnSeq}` (one turn = one
 * change set); each file's stable id is `${changeSetId}:${pathAfter||pathBefore}`
 * so the resume can map a per-file decision back to its path without depending on
 * any other identity. The streamed file-edit rows are hidden in place (an
 * append-only-safe status change), so file_change_sets is the only place a file
 * edit is reviewed.
 */

import {
  FileCaptureClass,
  FileChangeKind,
  FileChangeType,
  FileDecisionAction,
  FileDecisionScope,
  FileReviewFailureKind,
  SnapshotKind,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { create } from "@bufbuild/protobuf";
import type {
  AgentMessage,
  FileContent,
  ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
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
import { utcTimestamp } from "../../shared/status.js";
import { approvalCategory } from "./approval-policy.js";
import { toolIdentity, primaryToken } from "./approval-state.js";
import { contentDigest } from "../../shared/file-tools.js";
import { hideToolCallRow } from "./message-translator.js";
import {
  appendFileReviewEvents,
  buildBaselineCapturedEvent,
  buildCandidateCapturedEvent,
  buildCapturedFileChange,
  buildFailedEvent,
  buildReconciledEvent,
  sha256Bytes,
  type CapturedChangeInput,
  type ChangeSetContext,
} from "../../shared/filereview/index.js";
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
} from "./shadow-capture.js";

/** The harness id the projection reads from the BASELINE payload (load-bearing). */
const HARNESS_ID = "cursor";

/**
 * Turn start: pin the pre-turn working tree behind the baseline ref and author
 * the BASELINE_CAPTURED event. The projection reads `turn_id`/`harness_id` ONLY
 * from this payload, so `turnId == changeSetId` (one turn = one change set) and
 * `harnessId == "cursor"`. Returns the baseline tree sha for the turn-end diff.
 *
 * Appends onto `status.fileReviewEventStream`; the event rides the next persist.
 */
export async function captureBaselineToLedger(opts: {
  readonly status: AgentExecutionStatus;
  readonly gitRoot: string;
  readonly executionId: string;
  readonly changeSetId: string;
}): Promise<string> {
  const { status, gitRoot, executionId, changeSetId } = opts;
  const baselineTree = await snapshotBaseline(gitRoot, executionId);
  const event = buildBaselineCapturedEvent(
    changeSetContext(changeSetId),
    gitTreeSnapshotRef(baselineTree, baselineRef(executionId)),
  );
  appendFileReviewEvents(status, executionId, [event]);
  return baselineTree;
}

/**
 * Turn end: build the change set, LEAVE the working tree in its applied ("after")
 * state (Cursor parity — the user reviews the real change; nothing is committed
 * and the next turn is blocked until they decide), hide the streamed file-edit
 * rows that flowed, and author the CANDIDATE_CAPTURED event. The pinned
 * baseline/after refs are the authoritative source for the resume-time reconcile
 * ({@link applyCaptureDecisions}).
 *
 * `deniedTokens` are the identities the hook gated this turn (shell/MCP, or a
 * gitignored write/delete). A streamed file-edit row whose identity is in that
 * set is left for the deny-gate reconcile path — it did NOT flow (the hook denied
 * it), so it must not be hidden as a flowed edit.
 *
 * Mutates `messages` and `status` in place. Returns the captured changes.
 */
export async function captureTurnToLedger(opts: {
  readonly status: AgentExecutionStatus;
  readonly gitRoot: string;
  readonly executionId: string;
  readonly changeSetId: string;
  readonly baselineTree: string;
  readonly messages: AgentMessage[];
  readonly deniedTokens: ReadonlySet<string>;
}): Promise<readonly GitCapturedChange[]> {
  const { status, gitRoot, executionId, changeSetId, baselineTree, messages, deniedTokens } = opts;

  const { afterTree, changes } = await captureChangeSet(gitRoot, executionId, baselineTree);
  // Cursor parity: the agent's edits are LEFT applied on the working tree so the
  // user reviews the real, on-disk change. Nothing is committed; the next turn is
  // blocked until approval, and a reject snaps each file back exactly on resume.

  // Single review surface: the per-file edits now live on the file_review ledger
  // (projected to file_change_sets), so hide the streamed file-edit rows that
  // flowed this turn. Denied (gitignored/shell) rows stay on the deny-gate path.
  hideFlowedFileEditRows(messages, deniedTokens);

  if (changes.length === 0) return changes;

  const captured = changes.map((change) =>
    buildCapturedFileChange(toCapturedChangeInput(changeSetId, change)),
  );
  const event = buildCandidateCapturedEvent(
    changeSetContext(changeSetId),
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
}): Promise<CaptureResumeResult> {
  const { status, gitRoot, executionId, changeSet } = opts;

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
        changeSetContext(changeSet.id),
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
  const approvedSnapshot = await snapshotApproved(gitRoot, executionId);
  appendFileReviewEvents(status, executionId, [
    buildReconciledEvent(
      changeSetContext(changeSet.id),
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
function changeSetContext(changeSetId: string): ChangeSetContext {
  return {
    changeSetId,
    turnId: changeSetId,
    harnessId: HARNESS_ID,
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

/** Map the legacy git capture kind to the file-review {@link FileChangeKind}. */
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

/**
 * Hide every streamed file-edit row (category write/delete) that flowed this
 * turn, so the file_change_sets projection is the single review surface. Skips:
 *  - already-hidden rows (idempotent across re-persists / activity retries);
 *  - denied identities (the deny-gate reconcile path owns those rows).
 */
function hideFlowedFileEditRows(
  messages: AgentMessage[],
  deniedTokens: ReadonlySet<string>,
): void {
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (isAlreadyHidden(tc)) continue;
      const category = approvalCategory(tc.name);
      if (category !== "write" && category !== "delete") continue;
      const args = (tc.args ?? {}) as Record<string, unknown>;
      const id = toolIdentity(tc.name, tc.mcpServerSlug, args);
      const token = primaryToken(id.key, id.salient, contentDigest(args));
      if (deniedTokens.has(token)) continue; // denied -> reconcile path owns it
      hideToolCallRow(tc);
    }
  }
}

/** Mirror of the SDK's collapsed-row predicate (see message-translator). */
function isAlreadyHidden(tc: ToolCall): boolean {
  return (
    tc.status === ToolCallStatus.TOOL_CALL_SKIPPED &&
    !tc.requiresApproval &&
    tc.fileChanges.length === 0 &&
    !tc.result &&
    !tc.error
  );
}

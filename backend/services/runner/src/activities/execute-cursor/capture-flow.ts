/**
 * Capture-mode turn orchestration for the Cursor harness (git workspaces).
 *
 * This is the glue between the git snapshot/restore substrate (shadow-capture.ts)
 * and the agent execution transcript: it turns "the agent edited files freely
 * this turn" into "one Accept/Reject card per changed file, reviewed against the
 * real on-disk change", and on resume reconciles the tree to the user's
 * decisions.
 *
 * It owns the two turn-boundary transforms and nothing else:
 *  - {@link captureTurnForApproval} (turn end): capture the change set, LEAVE the
 *    working tree in its applied state (Cursor parity — nothing is committed and
 *    the next turn is blocked until approval), hide the streamed file-edit rows,
 *    and append ONE WAITING_APPROVAL card per changed file carrying the
 *    authoritative git-derived diff.
 *  - {@link applyCaptureDecisions} (resume): recompute the change set from the
 *    pinned refs and reconcile the tree to the decisions — keep approved files
 *    (re-asserted from the "after" ref), snap rejected/undecided files back to
 *    baseline — then flip each card COMPLETED/SKIPPED in place and drop the refs.
 *
 * The synthetic card ids are `capture:<repo-relative-path>` so the resume side
 * can recover each file's decision without depending on any other identity. New
 * cards are APPENDED (never replacing a streamed id), and the streamed file-edit
 * rows are hidden in place — both satisfy the backend's append-only-at-identity
 * guard (it rejects only dropping a committed id, never adding one or changing a
 * status in place).
 */

import { create } from "@bufbuild/protobuf";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type {
  AgentMessage,
  ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ApprovalAction,
  FileChangeType,
  MessageType,
  ToolCallStatus,
  ToolKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { utcTimestamp } from "../../shared/status.js";
import { approvalCategory } from "./approval-policy.js";
import { toolIdentity, primaryToken } from "./approval-state.js";
import { contentDigest } from "../../shared/file-tools.js";
import { hideToolCallRow } from "./message-translator.js";
import {
  applyApprovedPaths,
  captureChangeSet,
  dropCaptureRefs,
  recomputeChangeSet,
  restoreToBaseline,
  snapshotBaseline,
  type CapturedFileChange,
} from "./shadow-capture.js";

/** The id prefix that marks a runner-synthesized per-file capture card. */
const CAPTURE_CARD_ID_PREFIX = "capture:";

/** Snapshot the pre-turn working tree (capture mode, turn start). */
export async function snapshotCaptureBaseline(
  gitRoot: string,
  executionId: string,
): Promise<string> {
  return snapshotBaseline(gitRoot, executionId);
}

/**
 * Turn-end capture: build the change set, LEAVE the working tree in its applied
 * ("after") state (Cursor parity — the user reviews the real change; nothing is
 * committed and the next turn is blocked until they decide), hide the streamed
 * file-edit rows that flowed, and append one WAITING_APPROVAL card per changed
 * file. The pinned baseline/after refs are the authoritative source for the
 * resume-time reconcile ({@link applyCaptureDecisions}).
 *
 * `deniedTokens` are the identities the hook gated this turn (shell/MCP, or a
 * gitignored write/delete). A streamed file-edit row whose identity is in that
 * set is left for the deny-gate reconcile path — it did NOT flow (the hook
 * denied it), so it must not be hidden as a flowed edit.
 *
 * Mutates `messages` in place. Returns the captured changes (one per card).
 */
export async function captureTurnForApproval(opts: {
  readonly gitRoot: string;
  readonly executionId: string;
  readonly baselineTree: string;
  readonly messages: AgentMessage[];
  readonly deniedTokens: ReadonlySet<string>;
}): Promise<readonly CapturedFileChange[]> {
  const { gitRoot, executionId, baselineTree, messages, deniedTokens } = opts;

  const { changes } = await captureChangeSet(gitRoot, executionId, baselineTree);
  // Cursor parity: the agent's edits are LEFT applied on the working tree so the
  // user reviews the real, on-disk change (the workspace browser shows it and
  // the agent's "I edited X" narration stays true). Nothing is committed and the
  // next turn is blocked until approval; a reject snaps each file back exactly on
  // resume (applyCaptureDecisions -> restoreToBaseline). We do NOT revert here.

  // Hide the streamed file-edit rows that flowed this turn — their net change is
  // now shown on a per-file card. Leaves denied (gitignored/shell) rows alone.
  hideFlowedFileEditRows(messages, deniedTokens);

  if (changes.length === 0) return changes;

  const cards = changes.map((change) => buildCaptureCard(change));
  messages.push(
    create(AgentMessageSchema, {
      type: MessageType.MESSAGE_AI,
      content: "",
      timestamp: utcTimestamp(),
      toolCalls: cards,
    }),
  );
  return changes;
}

/** Outcome of applying the user's per-file decisions on resume. */
export interface CaptureResumeResult {
  /** False when this resume is not a capture turn (no capture ref present). */
  readonly isCaptureTurn: boolean;
  /** Repo-relative paths applied (approved) to the working tree. */
  readonly approvedPaths: readonly string[];
  /** Repo-relative paths discarded (rejected / undecided-then-skipped). */
  readonly rejectedPaths: readonly string[];
  /** True when at least one file card was rejected. */
  readonly hadReject: boolean;
}

/**
 * Resume: reconcile the working tree to the per-file decisions, sourced entirely
 * from the pinned baseline/after refs — approved files are ensured at their
 * "after" bytes (uncommitted; normally already on disk from the review window,
 * re-asserted idempotently), rejected/undecided files are snapped back to their
 * exact baseline bytes. Then flip each capture card COMPLETED (approved) or
 * SKIPPED (rejected/undecided) in place and release the refs. Because both sides
 * are ref-sourced, the result is correct regardless of the tree's current
 * contents (idempotent under a Temporal retry or a tree reset).
 *
 * Mutates `messages` in place.
 */
export async function applyCaptureDecisions(opts: {
  readonly gitRoot: string;
  readonly executionId: string;
  readonly messages: AgentMessage[];
}): Promise<CaptureResumeResult> {
  const { gitRoot, executionId, messages } = opts;

  const recomputed = await recomputeChangeSet(gitRoot, executionId);
  if (!recomputed) {
    return { isCaptureTurn: false, approvedPaths: [], rejectedPaths: [], hadReject: false };
  }

  // Decision per path, recovered from the capture cards' ids + approval_action.
  const cardByPath = new Map<string, ToolCall>();
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (!tc.id.startsWith(CAPTURE_CARD_ID_PREFIX)) continue;
      if (tc.status !== ToolCallStatus.TOOL_CALL_WAITING_APPROVAL) continue;
      cardByPath.set(tc.id.slice(CAPTURE_CARD_ID_PREFIX.length), tc);
    }
  }

  const approved: CapturedFileChange[] = [];
  const rejected: CapturedFileChange[] = [];
  const approvedPaths: string[] = [];
  const rejectedPaths: string[] = [];
  let hadReject = false;

  for (const change of recomputed.changes) {
    const card = cardByPath.get(change.path);
    const action = card?.approvalAction ?? ApprovalAction.UNSPECIFIED;
    if (action === ApprovalAction.APPROVE || action === ApprovalAction.APPROVE_ALL) {
      approved.push(change);
      approvedPaths.push(change.path);
    } else {
      if (action === ApprovalAction.REJECT) hadReject = true;
      rejected.push(change);
      rejectedPaths.push(change.path);
    }
  }

  // Reconcile the working tree to the decisions from the authoritative refs:
  // approved files keep (re-assert) their "after" bytes; rejected/undecided
  // files snap back to baseline. Both sides are ref-sourced, so this converges
  // to the correct end state no matter what the tree currently holds.
  await applyApprovedPaths(gitRoot, recomputed.afterTree, approved);
  await restoreToBaseline(gitRoot, recomputed.baselineTree, rejected);

  // Flip the cards in place (append-only-safe — status change, id preserved).
  for (const [path, card] of cardByPath) {
    const applied = approvedPaths.includes(path);
    card.status = applied
      ? ToolCallStatus.TOOL_CALL_COMPLETED
      : ToolCallStatus.TOOL_CALL_SKIPPED;
    card.requiresApproval = false;
    if (!card.completedAt) card.completedAt = utcTimestamp();
  }

  await dropCaptureRefs(gitRoot, executionId);

  return { isCaptureTurn: true, approvedPaths, rejectedPaths, hadReject };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Hide every streamed file-edit row (category write/delete) that flowed this
 * turn, so the per-file cards are the single review surface. Skips:
 *  - our own capture cards (id prefix), so a prior turn's COMPLETED card stays;
 *  - already-hidden rows (idempotent across re-persists / activity retries);
 *  - denied identities (the deny-gate reconcile path owns those rows).
 */
function hideFlowedFileEditRows(
  messages: AgentMessage[],
  deniedTokens: ReadonlySet<string>,
): void {
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (tc.id.startsWith(CAPTURE_CARD_ID_PREFIX)) continue;
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

/** Build the per-file WAITING_APPROVAL card from a captured change. */
function buildCaptureCard(change: CapturedFileChange): ToolCall {
  const isDelete = change.changeType === FileChangeType.DELETE;
  return create(ToolCallSchema, {
    id: `${CAPTURE_CARD_ID_PREFIX}${change.path}`,
    // The name drives the cross-edition approval CATEGORY (tool_category.go):
    // "edit"/"delete" -> write/delete, so the card projects as a pending
    // approval and a one-click "Keep All" (APPROVE_ALL) groups the write-class
    // cards via DeriveLeaseScope.
    name: isDelete ? "delete" : "edit",
    status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    requiresApproval: true,
    approvalAction: ApprovalAction.UNSPECIFIED,
    approvalMessage: approvalMessageFor(change),
    approvalRequestedAt: utcTimestamp(),
    toolKind: toolKindFor(change.changeType),
    argsPreview: change.path,
    fileChanges: [change.fileChange],
  });
}

function approvalMessageFor(change: CapturedFileChange): string {
  // Keep/discard framing: in capture mode the change is already applied on disk,
  // so approval is a decision to KEEP it (reject discards it), matching the
  // Cursor IDE's Accept/Reject semantics.
  switch (change.changeType) {
    case FileChangeType.CREATE:
      return `Keep new file: ${change.path}`;
    case FileChangeType.DELETE:
      return `Keep deletion of: ${change.path}`;
    default:
      return `Keep edit to: ${change.path}`;
  }
}

function toolKindFor(changeType: FileChangeType): ToolKind {
  switch (changeType) {
    case FileChangeType.CREATE:
      return ToolKind.FILE_WRITE;
    case FileChangeType.DELETE:
      return ToolKind.FILE_DELETE;
    default:
      return ToolKind.FILE_EDIT;
  }
}

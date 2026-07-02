/**
 * Resume-time exact-apply for approved whole-file writes (Cursor deny-only HITL).
 *
 * THE GUARANTEE THIS RESTORES
 * ---------------------------
 * A user must get "what you approve is what gets applied" — the contract the
 * native LangGraph harness and Cursor's own IDE honor by pausing at the exact
 * tool call and applying its exact args on approval. The Cursor deny-only
 * harness cannot pause: it denies the tool, grants the RESOURCE (`write\n<path>`),
 * and reinvokes the model, which REGENERATES content from scratch. So the bytes
 * that land can differ from the bytes the gate showed (observed in production: a
 * gate previewing one edit, an applied file carrying more).
 *
 * The fix turns an approved WHOLE-FILE write into a runner-executed action: the
 * runner writes the EXACT approved bytes itself, marks the tool COMPLETED, and —
 * crucially — issues NO resource grant for it. Any FURTHER write the model makes
 * to that file on reinvocation is therefore re-gated, so the user sees and
 * approves every change. This module owns the apply AND the grant-exclusion
 * derivation ({@link excludeAppliedFromGrants}, the "issues NO grant" half); the
 * caller wires the resulting grants and the prompt split (so the model is told
 * the write is already applied and does not redo it).
 *
 * SCOPE — whole-file writes only. A hunk edit (`old_string`/`new_string`) is left
 * on the grant + reinvocation path: applying a hunk would require locating the
 * fragment in the file, which would make the runner a second source of truth for
 * the edit result. Shell/MCP grants are already command-/name-specific, so their
 * approved==applied property is already tight.
 *
 * SOURCE OF TRUTH — the approved whole-file bytes and target path are read from
 * the gated tool call's `args` (the authoritative proposed content the deny-gate
 * stamped from the hook input; see execute-cursor/message-translator.ts
 * `applyGateInput`). This is the single copy — there is no separate captured
 * `file_changes` mirror — so "what was shown == what is applied" holds by
 * construction. (Phase 5 Slice 4 removed the redundant `ToolCall.file_changes`
 * copy; `args` was always its source.)
 *
 * SAFETY — exact-apply writes ONLY a fully-resolved body. It never writes a
 * truncated preview or the elision marker (which would silently corrupt the
 * file); an unresolvable body or any write failure degrades to the existing
 * grant + reinvocation path. Corruption is never an option — degradation to the
 * prior behavior is.
 *
 * TESTING — the apply + grant-exclusion + re-gating composition is proven
 * end-to-end (real workspace backend + the real deny-oracle hook) in
 * `__tests__/deny-gate-exact-apply.test.ts`. That deterministic runner test is
 * the achievable substitute for a pure-Go offline e2e, which is structurally
 * infeasible (there is no offline Cursor agent driver — see DD-23).
 */

import { isAbsolute, relative, resolve } from "node:path";
import {
  ApprovalAction,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type {
  AgentMessage,
  ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ELISION_MARKER } from "../../shared/status-offload.js";
import { extractFilePath, extractWriteContent } from "../../shared/file-tools.js";
import { resolveWorkspacePath } from "../../shared/file-change.js";
import type { WorkspaceBackend } from "../../shared/workspace/types.js";
import { utcTimestamp } from "../../shared/status.js";

/** Options for {@link applyApprovedWholeFileWrites}. */
export interface ExactApplyOptions {
  /** The (seeded) transcript whose approved tool calls are applied in place. */
  readonly messages: AgentMessage[];
  /** Workspace the files live in (local FS for OSS, sandbox in cloud). */
  readonly workspaceBackend: WorkspaceBackend;
  /** Configured workspace roots; a write is refused outside all of them. */
  readonly workspaceDirs: readonly string[];
  /** For structured logs. */
  readonly executionId: string;
}

/**
 * Apply every APPROVED whole-file write in `messages` to disk with its EXACT
 * approved bytes, marking each applied tool call COMPLETED in place.
 *
 * Returns the set of tool-call ids that were exact-applied, so the caller can
 * (a) exclude their resources from the approval grants — the key to re-gating a
 * later write — and (b) describe them as "already applied" in the reinvocation
 * prompt rather than asking the model to redo them.
 *
 * Idempotent: a call already COMPLETED (a Temporal activity retry re-runs this
 * phase) is skipped, never written twice. Every uncertain case (no resolvable
 * body, out-of-workspace target, write failure) is SKIPPED, leaving the call
 * WAITING_APPROVAL so the existing grant + reinvocation path handles it — the
 * conservative fallback that can never corrupt a file.
 */
export async function applyApprovedWholeFileWrites(
  opts: ExactApplyOptions,
): Promise<Set<string>> {
  const applied = new Set<string>();

  for (const msg of opts.messages) {
    for (const tc of msg.toolCalls) {
      if (!isApprovedWholeFileWrite(tc)) continue;

      const args = argsRecord(tc);
      const rawPath = extractFilePath(args);
      if (!rawPath) {
        // A whole-file write always carries a path arg; a missing one is
        // unexpected — do not guess a path, fall back.
        logSkip(opts.executionId, tc, "no file path in tool args");
        continue;
      }
      // Resolve against the workspace root with the same convention the gate used
      // (Cursor: real paths, not virtual), so the applied path matches the one the
      // user approved.
      const { absolutePath: target } = resolveWorkspacePath(
        rawPath,
        opts.workspaceBackend.rootDir,
        /* virtualRoot */ false,
      );
      if (!isWithinWorkspace(target, opts.workspaceDirs)) {
        logSkip(opts.executionId, tc, `target outside workspace: ${target}`);
        continue;
      }

      const content = resolveApprovedWholeFileContent(tc);
      if (content === null) {
        logSkip(opts.executionId, tc, "exact approved bytes unresolvable");
        continue;
      }

      try {
        await opts.workspaceBackend.writeFile(target, content);
      } catch (err) {
        logSkip(
          opts.executionId,
          tc,
          `write failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      // The tool is now genuinely done: the runner applied exactly what the user
      // approved (the same `args` bytes the gate showed). Mark COMPLETED in place
      // (same id — the backend's append-only-at-identity guard accepts a status
      // change). The approval_action is preserved as the audit trail; the status
      // flip removes it from the server's pending_approvals projection (which
      // keys on WAITING_APPROVAL).
      tc.status = ToolCallStatus.TOOL_CALL_COMPLETED;
      if (!tc.completedAt) tc.completedAt = utcTimestamp();
      tc.error = "";
      applied.add(tc.id);
      console.log(
        `ExecuteCursor exact-apply: wrote approved bytes to ${target} ` +
          `(tool=${tc.id}); no resource grant issued, so a further change ` +
          `re-gates. execution=${opts.executionId}`,
      );
    }
  }

  return applied;
}

/**
 * The adjudicated approvals MINUS the ones the runner already exact-applied — the
 * set the caller turns into resource grants for the resumed agent.
 *
 * This is the "issues NO grant for an applied write" half of the guarantee: an
 * exact-applied whole-file write is intentionally NOT granted, so if the
 * reinvoked model writes to that same file again it is re-gated and the user
 * reviews the new change (the deny-gate's "what you approve is what gets applied"
 * property). Non-applied approvals (hunk edits, shell, MCP, and every reject /
 * skip) pass through unchanged — they still need their grant to flow on resume.
 *
 * Pure and order-independent. Load-bearing because the caller computes the
 * adjudicated set ONCE (before {@link applyApprovedWholeFileWrites} flips the
 * applied calls to COMPLETED) and never re-derives it, so this exclusion is the
 * only thing that keeps an applied write out of the grants.
 */
export function excludeAppliedFromGrants(
  adjudicatedApprovals: readonly PendingApproval[],
  appliedToolCallIds: ReadonlySet<string>,
): PendingApproval[] {
  return adjudicatedApprovals.filter((pa) => !appliedToolCallIds.has(pa.toolCallId));
}

/**
 * The exact approved bytes for a whole-file write, or `null` when they cannot be
 * recovered (in which case the caller must fall back, never write).
 *
 * The bytes come from the gated call's `args` whole-file content — the single
 * authoritative copy of the proposed body (the deny-gate stamped it from the
 * hook input; see {@link isApprovedWholeFileWrite}). `args` is never offloaded to
 * a ref (only dropped wholesale by the aggregate size backstop), so when present
 * it is intact.
 *
 * It NEVER returns the elision marker: that is a lossy stand-in and writing it
 * would corrupt the file. An `args` body equal to the marker is treated as
 * unresolved, and the caller degrades to grant + reinvocation.
 */
export function resolveApprovedWholeFileContent(tc: ToolCall): string | null {
  const content = extractWriteContent(argsRecord(tc));
  if (content !== null && content !== ELISION_MARKER) return content;
  return null;
}

/**
 * Whether `tc` is an approved, still-pending WHOLE-FILE write eligible for
 * exact-apply. APPROVE and APPROVE_ALL both approve the clicked tool (the latter
 * also leases the class, handled separately by the caller). A SKIP/REJECT, an
 * edit-family call (`old_string`/`new_string`, which carries no whole-file body),
 * and an already-applied (COMPLETED) call are all excluded.
 *
 * The whole-file predicate is `extractWriteContent(args) !== null` — the exact
 * condition the removed field-22 capture used to classify a change WHOLE_FILE
 * (a whole-file body present) vs HUNK_ONLY (an edit fragment). Reading it from
 * `args` keeps eligibility on the single source of truth.
 */
function isApprovedWholeFileWrite(tc: ToolCall): boolean {
  if (tc.status !== ToolCallStatus.TOOL_CALL_WAITING_APPROVAL) return false;
  if (
    tc.approvalAction !== ApprovalAction.APPROVE &&
    tc.approvalAction !== ApprovalAction.APPROVE_ALL
  ) {
    return false;
  }
  return extractWriteContent(argsRecord(tc)) !== null;
}

/** The gated tool call's structured args as a plain record (empty when absent). */
function argsRecord(tc: ToolCall): Record<string, unknown> {
  return tc.args && typeof tc.args === "object"
    ? (tc.args as Record<string, unknown>)
    : {};
}

/** Whether `absTarget` resolves inside one of the configured workspace roots. */
function isWithinWorkspace(
  absTarget: string,
  workspaceDirs: readonly string[],
): boolean {
  const target = resolve(absTarget);
  return workspaceDirs.some((dir) => {
    const root = resolve(dir);
    if (target === root) return true;
    const rel = relative(root, target);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  });
}

function logSkip(executionId: string, tc: ToolCall, reason: string): void {
  console.log(
    `ExecuteCursor exact-apply skipped (falling back to grant+reinvocation): ` +
      `tool=${tc.id} reason="${reason}" execution=${executionId}`,
  );
}

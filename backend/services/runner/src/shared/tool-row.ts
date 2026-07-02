/**
 * Harness-agnostic helpers for a transcript tool-call row's file-review
 * presentation.
 *
 * When file edits are reviewed as a captured `FileChangeSet` (the apply-then-
 * review model), each flowed file-edit row STAYS visible at its transcript
 * position as an observational/audit record — "the agent edited this file,
 * here" — and is stamped with the change set id it contributed to
 * ({@link stampFileEditRow}). The ledger remains the single DECISION surface;
 * the row is never one (the research report's "transcript row references
 * change_set_id" / "tool-call rows are observational/audit-only for file
 * tools"). Both harnesses (Cursor deny-gate + deep-agent middleware) stamp rows
 * the same way, so the operation lives here.
 *
 * {@link hideToolCallRow} / {@link isToolCallRowHidden} remain for the OTHER
 * collapse consumer — a superseded same-turn denial twin — and as the render
 * shape of legacy (pre-stamping) sessions whose flowed edit rows were hidden.
 */

import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { extractFilePath } from "./file-tools.js";
import { isSecretLikePath } from "./filereview/secret-paths.js";
import { utcTimestamp } from "./status.js";

/**
 * Stamp a flowed file-edit row with the change set that captured its turn.
 * PRESENTATION/AUDIT-ONLY (see `ToolCall.file_change_set_id`): clients badge
 * the row with the set's review state and anchor the set's decision surface
 * after the turn's last stamped row. Never a correlation or enforcement key.
 *
 * Additive by design — the row keeps its args/result/status so the per-edit
 * diff the user watched stream stays rendered in place. The captured net diff
 * on the ledger is the only REVIEWED artifact; the row is a historical record.
 *
 * An already-stamped row is left untouched. This is load-bearing, not hygiene:
 * the turn-boundary pass re-walks the whole transcript, which on a resume
 * includes the prior turn's seeded rows — without this guard, turn N would
 * re-stamp turn N-1's rows with its own per-turn change set id (silent
 * mis-attribution).
 *
 * Defensive secret clear (DD-12 D4 belt-and-braces): flowed rows are never
 * secret in practice — the Cursor hook hard-denies secret-like writes before
 * they flow — but a write to a TRACKED secret-like path (e.g. a committed
 * credentials file) is outside the hook's gitignored scope. Such a row keeps
 * its path (a filename is not itself the secret) and is stripped of content
 * (`args` body, `result` diff, `args_preview`). Fail-closed: a file row whose
 * path cannot be determined is stripped rather than trusted.
 */
export function stampFileEditRow(tc: ToolCall, changeSetId: string): void {
  if (tc.fileChangeSetId) return;
  tc.fileChangeSetId = changeSetId;

  const path = extractFilePath((tc.args ?? {}) as Record<string, unknown>) ?? "";
  if (isSecretLikePath(path)) {
    tc.args = path ? { path } : undefined;
    tc.result = "";
    tc.argsPreview = "";
  }
}

/**
 * Collapse a tool-call row to the hidden shape the SDK renders as absent: a
 * SKIPPED row with no approval state, result, error, preview, or args.
 * Idempotent (re-running yields the same shape).
 *
 * `args` is cleared, not just `args_preview`. A hidden row is redundant with the
 * `file_change_set` (the single review surface), so its content must not linger
 * anywhere: for a file-mutating tool `args` holds the full write body, which for
 * a secret-like path would otherwise persist into the transcript / Temporal
 * history in violation of the never-persist-secret-contents contract (design
 * doc 12, D4). Dropping it is safe at resume — identity is carried by
 * `approval_content_digest`, deliberately immune to `args` being absent (the
 * size-limit elision already drops `args`); no consumer reads a hidden row's
 * `args`.
 */
export function hideToolCallRow(tc: ToolCall): void {
  tc.status = ToolCallStatus.TOOL_CALL_SKIPPED;
  tc.requiresApproval = false;
  tc.approvalRequestedAt = "";
  tc.approvalMessage = "";
  tc.error = "";
  tc.result = "";
  tc.argsPreview = "";
  tc.args = undefined;
  if (!tc.completedAt) tc.completedAt = utcTimestamp();
}

/**
 * Whether a tool-call row is already collapsed/hidden (the SDK's absent-row
 * predicate). Used to keep {@link hideToolCallRow} idempotent across re-persists
 * and activity retries.
 */
export function isToolCallRowHidden(tc: ToolCall): boolean {
  return (
    tc.status === ToolCallStatus.TOOL_CALL_SKIPPED &&
    !tc.requiresApproval &&
    tc.args === undefined &&
    !tc.result &&
    !tc.error
  );
}

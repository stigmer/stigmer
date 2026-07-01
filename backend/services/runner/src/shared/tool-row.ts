/**
 * Harness-agnostic helpers for collapsing a transcript tool-call row.
 *
 * When file edits are reviewed as a captured `FileChangeSet` (the apply-then-
 * review model), the streamed file-edit tool rows are redundant with the ledger,
 * so they are collapsed to a hidden row — `file_change_sets` is the single review
 * surface. Both harnesses (Cursor deny-gate + deep-agent middleware) collapse
 * rows the same way, so the operation and its inverse predicate live here.
 */

import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { utcTimestamp } from "./status.js";

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

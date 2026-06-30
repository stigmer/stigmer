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
 * SKIPPED row with no approval state, result, error, preview, or file changes.
 * Idempotent (re-running yields the same shape).
 */
export function hideToolCallRow(tc: ToolCall): void {
  tc.status = ToolCallStatus.TOOL_CALL_SKIPPED;
  tc.requiresApproval = false;
  tc.approvalRequestedAt = "";
  tc.approvalMessage = "";
  tc.error = "";
  tc.result = "";
  tc.argsPreview = "";
  tc.fileChanges = [];
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
    tc.fileChanges.length === 0 &&
    !tc.result &&
    !tc.error
  );
}

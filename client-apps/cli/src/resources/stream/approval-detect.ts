// Human-in-the-loop approval detection for the snapshot differ.
//
// Ports the dual-detection logic from Go's run_stream_events.go (the
// pending_approvals scan at :397-415 and the defense-in-depth tool-status scan
// at :417-448) plus the helpers in run_stream_approval.go. The differ uses these
// to emit ApprovalNeededEvent exactly once per tool call until a new approval
// cycle resets the dedup set.

import { create } from "@bufbuild/protobuf";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  type PendingApproval,
  PendingApprovalSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ApprovalNeededEvent } from "./events.js";

/** A tool call awaiting approval, with sub-agent provenance. Mirrors Go's unpromptedApproval. */
export interface UnpromptedApproval {
  readonly toolCall: ToolCall;
  readonly fromSubAgent: boolean;
  readonly subAgentName: string;
}

/** The dedup key for a pending approval (its tool-call ID). Mirrors Go's approvalDedupKey. */
export function approvalDedupKey(pa: PendingApproval): string {
  return pa.toolCallId;
}

/**
 * True if at least one approval has a non-empty key not yet prompted. When every
 * entry is degraded or already prompted, the caller falls back to the tool-status
 * scan. Mirrors Go's hasUsableApproval.
 */
export function hasUsableApproval(approvals: readonly PendingApproval[], promptedIds: ReadonlySet<string>): boolean {
  return approvals.some((pa) => {
    const key = approvalDedupKey(pa);
    return key !== "" && !promptedIds.has(key);
  });
}

/**
 * Scan top-level and sub-agent tool calls for any in WAITING_APPROVAL not yet
 * prompted. This is the defense-in-depth path for snapshots whose
 * pending_approvals is missing or degraded. Mirrors Go's findAllUnpromptedApprovals.
 */
export function findAllUnpromptedApprovals(
  toolCalls: readonly ToolCall[],
  subAgents: readonly SubAgentExecution[],
  promptedIds: ReadonlySet<string>,
): UnpromptedApproval[] {
  const result: UnpromptedApproval[] = [];

  for (const tc of toolCalls) {
    if (isUnpromptedWaiting(tc, promptedIds)) {
      result.push({ toolCall: tc, fromSubAgent: false, subAgentName: "" });
    }
  }

  for (const sa of subAgents) {
    for (const msg of sa.messages) {
      for (const tc of msg.toolCalls) {
        if (isUnpromptedWaiting(tc, promptedIds)) {
          result.push({ toolCall: tc, fromSubAgent: true, subAgentName: sa.name });
        }
      }
    }
  }

  return result;
}

function isUnpromptedWaiting(tc: ToolCall, promptedIds: ReadonlySet<string>): boolean {
  return tc.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL && tc.id !== "" && !promptedIds.has(tc.id);
}

/**
 * Build a synthetic PendingApproval from a tool call, for the tool-status scan
 * path where the phase-level approval is unavailable. Mirrors Go's
 * buildPendingApprovalFromToolCall.
 */
export function buildPendingApprovalFromToolCall(tc: ToolCall): PendingApproval {
  return create(PendingApprovalSchema, {
    toolCallId: tc.id,
    toolName: tc.name,
    requestedAt: tc.startedAt,
    argsPreview: tc.args !== undefined ? JSON.stringify(tc.args) : "",
  });
}

/**
 * Extract the ApprovalNeededEvent payload from a tool call and pending approval,
 * preferring the richer PendingApproval fields and filling gaps from the tool
 * call. Mirrors Go's extractApprovalInfo. `dedupKey` is the key already chosen
 * by the caller (so the cycle-reset bookkeeping stays consistent).
 */
export function buildApprovalNeeded(tc: ToolCall | undefined, pa: PendingApproval): ApprovalNeededEvent {
  let toolCallId = pa.toolCallId;
  let toolName = pa.toolName;
  let argsPreview = pa.argsPreview;

  if (tc !== undefined) {
    if (toolCallId === "") toolCallId = tc.id;
    if (toolName === "") toolName = tc.name;
    if (argsPreview === "" && tc.args !== undefined) argsPreview = JSON.stringify(tc.args);
  }

  return {
    kind: "approvalNeeded",
    toolCallId,
    toolName,
    argsPreview,
    message: pa.message,
    fromSubAgent: pa.fromSubAgent,
    subAgentName: pa.subAgentName,
  };
}

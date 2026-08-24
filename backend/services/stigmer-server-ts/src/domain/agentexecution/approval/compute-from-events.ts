/**
 * The pending-approvals EVENT-STREAM projection — ports
 * approval/compute_from_events.go: every REQUESTED event whose approval
 * has not been resolved by a later terminal event — a user decision
 * (APPROVED/REJECTED/SKIPPED) or a system RETRACTED.
 *
 * This is the AUTHORITATIVE projection: projectPendingApprovals returns
 * its result. For a given execution it must produce the same set as the
 * retained message-scan cross-check; project.ts asserts that equality in
 * production and the shared HITL corpus asserts it in CI. The RETRACTED
 * resolution is what lets the two agree for the in-flight orphan exits
 * the scan handles structurally — see reconcileRetractions (author.ts).
 * Terminal-execution gate-exits are handled one level up, by the
 * phase-aware seam, not here. Correlation is by approval_request_id
 * (today, the tool_call_id).
 */
import { create } from "@bufbuild/protobuf";

import type {
  ApprovalEventStream,
  ApprovalRequest,
  PendingApproval,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ApprovalEventType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

export function computePendingApprovalsFromEvents(
  stream: ApprovalEventStream | undefined,
): PendingApproval[] {
  if (stream === undefined) {
    return [];
  }

  const resolved = new Set<string>();
  for (const ev of stream.events) {
    if (isResolvingEvent(ev.eventType)) {
      resolved.add(ev.approvalRequestId);
    }
  }

  const result: PendingApproval[] = [];
  for (const ev of stream.events) {
    if (ev.eventType !== ApprovalEventType.REQUESTED) {
      continue;
    }
    if (resolved.has(ev.approvalRequestId)) {
      continue;
    }
    if (ev.payload.case === "requested") {
      result.push(pendingApprovalFromRequest(ev.payload.value));
    }
  }
  return result;
}

/**
 * Whether an event type terminally resolves a REQUESTED: the three user
 * decisions plus the system RETRACTED. A resolved request never appears
 * in the pending projection.
 */
export function isResolvingEvent(t: ApprovalEventType): boolean {
  switch (t) {
    case ApprovalEventType.APPROVED:
    case ApprovalEventType.REJECTED:
    case ApprovalEventType.SKIPPED:
    case ApprovalEventType.RETRACTED:
      return true;
    default:
      return false;
  }
}

/**
 * Reconstructs a PendingApproval from a REQUESTED event's payload.
 * ApprovalRequest intentionally carries the same display fields as
 * PendingApproval so this projection needs no join back to the ToolCall.
 */
function pendingApprovalFromRequest(req: ApprovalRequest): PendingApproval {
  return create(PendingApprovalSchema, {
    toolCallId: req.toolCallId,
    toolName: req.toolName,
    message: req.message,
    argsPreview: req.argsPreview,
    requestedAt: req.requestedAt,
    fromSubAgent: req.fromSubAgent,
    subAgentName: req.subAgentName,
    subAgentSubject: req.subAgentSubject,
    mcpServerSlug: req.mcpServerSlug,
    toolKind: req.toolKind,
    approvalPolicySource: req.approvalPolicySource,
  });
}

/**
 * PreserveApprovalFields — ports approval/preserve.go: copies
 * SubmitApproval-owned fields from existing (DB-loaded) tool calls onto
 * incoming (runner-sent) tool calls that have UNSPECIFIED
 * approval_action. This prevents updateStatus from overwriting approval
 * decisions that were atomically recorded by SubmitApproval — the runner
 * always sends UNSPECIFIED for these fields.
 *
 * The three preserved fields: approval_action, approval_decided_at,
 * approved_by. Tool call IDs are unique across root and sub-agent
 * messages, so a flat index is used. Incoming tool calls that already
 * carry a non-UNSPECIFIED approval_action are left untouched.
 */
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";

interface ApprovalSnapshot {
  readonly action: ApprovalAction;
  readonly decidedAt: string;
  readonly approvedBy: string;
}

export function preserveApprovalFields(
  incomingMessages: AgentMessage[],
  incomingSubAgents: SubAgentExecution[],
  existingMessages: AgentMessage[],
  existingSubAgents: SubAgentExecution[],
): void {
  const index = buildApprovalIndex(existingMessages, existingSubAgents);
  if (index.size === 0) {
    return;
  }

  applyApprovalFields(incomingMessages, index);
  for (const sa of incomingSubAgents) {
    applyApprovalFields(sa.messages, index);
  }
}

function buildApprovalIndex(
  messages: AgentMessage[],
  subAgentExecutions: SubAgentExecution[],
): Map<string, ApprovalSnapshot> {
  const index = new Map<string, ApprovalSnapshot>();
  collectFromMessages(messages, index);
  for (const sa of subAgentExecutions) {
    collectFromMessages(sa.messages, index);
  }
  return index;
}

function collectFromMessages(
  messages: AgentMessage[],
  index: Map<string, ApprovalSnapshot>,
): void {
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (tc.approvalAction !== ApprovalAction.UNSPECIFIED) {
        index.set(tc.id, {
          action: tc.approvalAction,
          decidedAt: tc.approvalDecidedAt,
          approvedBy: tc.approvedBy,
        });
      }
    }
  }
}

function applyApprovalFields(
  messages: AgentMessage[],
  index: Map<string, ApprovalSnapshot>,
): void {
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      const snap = index.get(tc.id);
      if (snap === undefined) {
        continue;
      }
      if (tc.approvalAction !== ApprovalAction.UNSPECIFIED) {
        continue;
      }
      tc.approvalAction = snap.action;
      tc.approvalDecidedAt = snap.decidedAt;
      tc.approvedBy = snap.approvedBy;
    }
  }
}

/**
 * The pending-approvals MESSAGE SCAN — ports approval/compute.go.
 *
 * A tool call qualifies as pending when:
 *   - status == TOOL_CALL_WAITING_APPROVAL
 *   - requires_approval == true
 *   - approval_action == UNSPECIFIED (no decision recorded yet)
 *
 * Since the source-of-truth flip this is the retained CROSS-CHECK, not
 * the returned result: projectPendingApprovals (project.ts) returns the
 * event-stream projection and runs this scan only to assert the two
 * agree. It is recomputed from the tool-call state in messages, which the
 * runner still writes authoritatively.
 */
import { create } from "@bufbuild/protobuf";

import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  SubAgentStatus,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type {
  AgentMessage,
  ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";

export function computePendingApprovals(
  messages: AgentMessage[],
  subAgentExecutions: SubAgentExecution[],
): PendingApproval[] {
  const result: PendingApproval[] = [];

  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      const pa = projectToolCall(tc, false, "", "");
      if (pa !== undefined) {
        result.push(pa);
      }
    }
  }

  for (const sa of subAgentExecutions) {
    if (isTerminalSubAgent(sa.status)) {
      continue;
    }
    for (const msg of sa.messages) {
      for (const tc of msg.toolCalls) {
        const pa = projectToolCall(tc, true, sa.name, sa.subject);
        if (pa !== undefined) {
          result.push(pa);
        }
      }
    }
  }

  return result;
}

/**
 * Whether the execution has reached a final phase. A terminal execution
 * has no actionable pending approvals — the workflow that would resume a
 * gated call no longer exists — so the projection seam collapses
 * pending_approvals to empty for these phases regardless of stale
 * tool-call state left in the transcript. This makes every
 * terminal-execution gate-exit (cancel / fail / terminate) correct
 * without authoring a per-call retraction event, and closes the
 * pre-existing edition split where OSS cleared a failed-at-gate
 * execution's pending_approvals via an incidental message wipe while
 * Cloud retained them.
 */
export function isTerminalExecution(phase: ExecutionPhase): boolean {
  switch (phase) {
    case ExecutionPhase.EXECUTION_COMPLETED:
    case ExecutionPhase.EXECUTION_FAILED:
    case ExecutionPhase.EXECUTION_CANCELLED:
    case ExecutionPhase.EXECUTION_TERMINATED:
      return true;
    default:
      return false;
  }
}

/**
 * Sub-agents that have reached a final lifecycle state. Any
 * WAITING_APPROVAL tool calls left inside a terminal sub-agent are
 * orphans and must not appear in pending_approvals.
 */
export function isTerminalSubAgent(status: SubAgentStatus): boolean {
  switch (status) {
    case SubAgentStatus.SUB_AGENT_COMPLETED:
    case SubAgentStatus.SUB_AGENT_FAILED:
    case SubAgentStatus.SUB_AGENT_CANCELLED:
      return true;
    default:
      return false;
  }
}

function projectToolCall(
  tc: ToolCall,
  fromSubAgent: boolean,
  subAgentName: string,
  subAgentSubject: string,
): PendingApproval | undefined {
  if (tc.status !== ToolCallStatus.TOOL_CALL_WAITING_APPROVAL) {
    return undefined;
  }
  if (!tc.requiresApproval) {
    return undefined;
  }
  if (tc.approvalAction !== ApprovalAction.UNSPECIFIED) {
    return undefined;
  }

  return create(PendingApprovalSchema, {
    toolCallId: tc.id,
    toolName: tc.name,
    message: tc.approvalMessage,
    argsPreview: tc.argsPreview,
    requestedAt: tc.approvalRequestedAt,
    fromSubAgent,
    subAgentName,
    // Mirrors Java PendingApprovalComputer: the sub-agent's task subject
    // lets approval surfaces label the card with the task instead of the
    // generic agent type. Empty for root tool calls.
    subAgentSubject,
    mcpServerSlug: tc.mcpServerSlug,
    // Denormalized for approval surfaces (like mcpServerSlug) so the
    // approval UI classifies the tool without re-deriving it.
    toolKind: tc.toolKind,
    // Denormalized (like toolKind) so the approval surface can explain
    // WHY the tool is gated without re-deriving the policy. Runner-written
    // on the ToolCall; copied through verbatim. The authoritative
    // event-stream projection copies it too (emit.ts /
    // compute-from-events.ts) so projectPendingApprovals fromEvents ==
    // fromScan holds (this scan is the retained cross-check).
    approvalPolicySource: tc.approvalPolicySource,
  });
}

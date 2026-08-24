/**
 * settleInterruptedToolCalls — ports controller/tool_call_settle.go:
 * settles every non-terminal tool call — PENDING, RUNNING, or
 * WAITING_APPROVAL — to TOOL_CALL_INTERRUPTED, across the top-level
 * transcript and every sub-agent transcript, in place. Enforces the
 * invariant that a terminal execution carries zero non-terminal tool
 * calls (issue #207): a terminal execution's workflow is gone, so an
 * in-flight call will never receive its terminal event and a gated call
 * can never be decided.
 *
 * Called by every terminal writer: the updateStatus merge chokepoint (on
 * a terminal merged phase), the Cancel/Terminate lifecycle transition,
 * and the stale-workflow reconcilers. Idempotent — settled rows are
 * terminal and re-running is a no-op.
 *
 * The settle is honest, not a hide: args, partial results, and approval
 * provenance are preserved for the audit trail. Only the status, the
 * completion timestamp (when empty, so a runner-recorded timestamp
 * survives), and the streaming marker change — nothing streams on a dead
 * execution, so a frozen streaming_source must not leave clients
 * rendering a live stream.
 *
 * A gated (WAITING_APPROVAL) call settled here authors NO approval event:
 * terminal-execution gate-exits are deliberately not modeled as per-call
 * events (a terminal execution simply projects to zero pending approvals;
 * RETRACTED is reserved for in-flight withdrawals).
 */
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ToolCallStatus,
  ToolCallStreamingSource,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

/** Returns the number of tool calls settled, for the callers' logs. */
export function settleInterruptedToolCalls(
  status: AgentExecutionStatus | undefined,
  completedAt: string,
): number {
  if (status === undefined) {
    return 0;
  }
  let settled = settleInMessages(status.messages, completedAt);
  for (const sa of status.subAgentExecutions) {
    settled += settleInMessages(sa.messages, completedAt);
  }
  return settled;
}

function settleInMessages(
  messages: AgentMessage[],
  completedAt: string,
): number {
  let settled = 0;
  for (const m of messages) {
    for (const tc of m.toolCalls) {
      switch (tc.status) {
        case ToolCallStatus.TOOL_CALL_PENDING:
        case ToolCallStatus.TOOL_CALL_RUNNING:
        case ToolCallStatus.TOOL_CALL_WAITING_APPROVAL: {
          tc.status = ToolCallStatus.TOOL_CALL_INTERRUPTED;
          if (tc.completedAt === "") {
            tc.completedAt = completedAt;
          }
          tc.streamingSource = ToolCallStreamingSource.UNSPECIFIED;
          settled++;
          break;
        }
        default:
          break;
      }
    }
  }
  return settled;
}

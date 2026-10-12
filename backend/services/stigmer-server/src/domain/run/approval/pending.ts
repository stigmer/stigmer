/**
 * A run's pending approvals: the row scan (compute.ts), kept to the calls
 * whose tool use still waits in the session's log.
 *
 * The log decides which calls wait: an `agent.tool_use` (or
 * `agent.mcp_tool_use`) the runner wrote with evaluated_permission `ask`
 * opens a gate, and its `user.tool_confirmation` or its result closes it
 * (domain/session/events/gates.ts). The rows still describe each waiting
 * call with every field an approval card shows (message, preview, policy,
 * MCP server, tool kind, sub-agent), so the scan supplies them. The
 * workflow's gate count (filereview/gate.ts), the requires_action idle's
 * event_ids and this field are then one fact.
 *
 * A row that waits with no open gate is not pending, and is logged: its
 * ask did not reach the log (the runner's append failed and its status
 * write went ahead), and the workflow's empty-gate repair re-invokes the
 * turn, whose emitter resends it. A terminal run has nothing pending.
 *
 * Proven by __tests__/pending.test.ts.
 */
import type { RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/run/v1/approval_pb";

import type { Logger } from "../../../boot/logger.js";
import { toolUseEventId } from "../../session/events/ids.js";
import { computePendingApprovals, isTerminalExecution } from "./compute.js";

/** The run's pending approvals given its open asks (tool use ids). */
export function pendingApprovalsOf(
  runId: string,
  status: RunStatus,
  openAsks: ReadonlySet<string>,
  logger?: Logger,
): PendingApproval[] {
  if (isTerminalExecution(status.phase)) {
    return [];
  }
  const pending: PendingApproval[] = [];
  const unasked: string[] = [];
  for (const approval of computePendingApprovals(status.messages, status.subAgentRuns)) {
    if (openAsks.has(toolUseEventId(runId, approval.toolCallId))) {
      pending.push(approval);
    } else {
      unasked.push(approval.toolCallId);
    }
  }
  if (unasked.length > 0) {
    logger?.warn("tool calls wait for approval with no open ask in the session's log", {
      signal: "hitl_waiting_row_without_ask",
      runId,
      toolCallIds: unasked,
    });
  }
  return pending;
}

/**
 * Terminal transitions on the sub-agent rows of an execution status,
 * operating on the proto array itself.
 *
 * One function today: marking every non-terminal sub-agent CANCELLED when a
 * turn ends without them (a pause, a shutdown, a stall, a cost cap, an
 * infrastructure cancel), so the final snapshot has no permanent IN_PROGRESS
 * "zombie" delegation. Harness-agnostic (a `SubAgentExecution` is the
 * platform's row, not an engine's), read by the turn runtime's terminal
 * table and the Cursor accumulator's own finalize alike.
 *
 * Moved from `activities/execute-cursor/message-translator.ts` at S2 M3 so
 * the runtime's catch can reach it; the body is unchanged.
 */

import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { SubAgentStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { utcTimestamp } from "./status.js";

/**
 * Transition any non-terminal sub-agent (IN_PROGRESS or PENDING) in the given
 * proto array to CANCELLED with a completion timestamp, in place. Returns
 * true if any sub-agent changed.
 */
export function cancelInProgressSubAgentProtos(subAgents: SubAgentExecution[]): boolean {
  let changed = false;
  for (const sub of subAgents) {
    if (
      sub.status === SubAgentStatus.SUB_AGENT_IN_PROGRESS ||
      sub.status === SubAgentStatus.SUB_AGENT_PENDING
    ) {
      sub.status = SubAgentStatus.SUB_AGENT_CANCELLED;
      sub.completedAt = utcTimestamp();
      changed = true;
    }
  }
  return changed;
}

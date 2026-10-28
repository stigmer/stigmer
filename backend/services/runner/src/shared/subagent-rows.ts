/**
 * Terminal transitions on the sub-agent rows of an execution status,
 * operating on the proto array itself.
 *
 * One function today: marking every non-terminal sub-agent CANCELLED when a
 * turn ends without them (a pause, a shutdown, a stall, a cost cap, an
 * infrastructure cancel), so the final snapshot has no permanent IN_PROGRESS
 * "zombie" delegation. Harness-agnostic (a `SubAgentRun` is the
 * platform's row, not an engine's), read by the turn runtime's terminal
 * table, whose catch reaches it here (#1070).
 */


import { utcTimestamp } from "./status.js";
import type { SubAgentRun } from "../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { SubAgentStatus } from "../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

/**
 * Transition any non-terminal sub-agent (IN_PROGRESS or PENDING) in the given
 * proto array to CANCELLED with a completion timestamp, in place. Returns
 * true if any sub-agent changed.
 */
export function cancelInProgressSubAgentProtos(subAgents: SubAgentRun[]): boolean {
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

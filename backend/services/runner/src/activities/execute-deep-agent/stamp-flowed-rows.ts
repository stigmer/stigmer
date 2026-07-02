/**
 * Deep-agent turn-boundary stamping of flowed file-edit rows — the deep-agent
 * analog of the Cursor adapter's `stampFlowedFileEditRows` (in `capture-flow.ts`),
 * minus deny-token coordination (this harness has no deny gate; every
 * write/delete flowed). Extracted from the activity entry point so it is
 * directly unit-testable, mirroring how `approval-file-change.ts` isolates the
 * capture helpers.
 *
 * Rows stay visible in place as observational records; `file_change_sets`
 * remains the single decision surface (DD-24).
 */

import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { toolApprovalCategory } from "../../shared/tool-kind.js";
import { isToolCallRowHidden, stampFileEditRow } from "../../shared/tool-row.js";

/**
 * Stamp every flowed file-edit row (category write/delete) with this turn's
 * change set id. Skips already-stamped rows (a resume seeds prior turns' rows
 * into this transcript — re-stamping would mis-attribute them) and legacy hidden
 * rows from pre-stamping sessions (they belong to an earlier turn's set).
 *
 * `skipToolCallIds` scopes the pass to rows CREATED this turn: a tool-call id
 * present before this turn's stream is skipped. Top-level callers omit it (a
 * top-level flowed row is this-turn's by the already-stamped/hidden shields);
 * sub-agent callers pass a pre-turn snapshot, since sub-agent rows have neither
 * shield (see `collectSubAgentToolCallIds` in `shared/tool-row.ts`).
 */
export function stampFlowedFileEditRows(
  messages: readonly AgentMessage[],
  changeSetId: string,
  skipToolCallIds?: ReadonlySet<string>,
): void {
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (tc.fileChangeSetId) continue;
      if (skipToolCallIds?.has(tc.id)) continue;
      if (isToolCallRowHidden(tc)) continue;
      const category = toolApprovalCategory(tc.name);
      if (category !== "write" && category !== "delete") continue;
      stampFileEditRow(tc, changeSetId);
    }
  }
}

/**
 * Stamp the current turn's sub-agent flowed file-edit rows with the parent
 * turn's change set id. Sub-agent writes fold their files into the SAME parent
 * turn set (shared git diff + one shared CasCaptureObserver, DD-19), so they
 * carry the parent change set id and badge against the same set the parent's
 * rows do. They live under `subAgentExecutions` (not the top-level transcript),
 * so they are walked separately and scoped to this turn via `priorToolCallIds`
 * (the sub-agent tool-call ids that existed before this turn's stream).
 */
export function stampFlowedSubAgentFileEditRows(
  subAgents: readonly SubAgentExecution[],
  changeSetId: string,
  priorToolCallIds: ReadonlySet<string>,
): void {
  for (const sa of subAgents) {
    stampFlowedFileEditRows(sa.messages, changeSetId, priorToolCallIds);
  }
}

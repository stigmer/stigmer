/**
 * The settlement of a gated call an unattended turn skipped: the one row
 * amendment every harness whose gate skips in-process makes after its
 * stream (the native settle, `execute-deep-agent/turn-settle.ts`; the
 * Claude settle, `execute-claude/settle.ts`). Cursor's boundary stamps the
 * same shape on its own rows (`execute-cursor/boundary-rows.ts`).
 */

import { POLICY_ENGINE_VERSION, unattendedSkipMessage } from "./approval-policy.js";
import type { AgentMessage, TurnRows } from "../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { ApprovalPolicySource, ToolCallStatus } from "../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

/**
 * Terminalize every tool call the approval gate auto-skipped under UNATTENDED
 * approval mode — the sibling of the runtime's `terminalizeNonExecutingDecisions`
 * for skips that have no human decision behind them.
 *
 * The gate (the single writer of the registry) records each auto-skipped
 * tool-call id at the moment it returns the skip ToolMessage; this reconciler
 * (the single writer of the terminal row) folds each id into:
 * - `status = TOOL_CALL_SKIPPED` — the tool did not run, whatever transient
 *   status the stream left behind (FAILED from the gate's refusal event,
 *   which opened the row with this provenance already, so the session's log
 *   wrote the skip as the policy's deny; or RUNNING when no event fired);
 * - `approval_policy_source = UNATTENDED_SKIP` — the resolution layer,
 *   overriding the gating-layer source stamped at tool-start (the
 *   AUTO_APPROVE_ALL precedent: layer-4 resolutions own the resolved call),
 *   with `approval_policy_hook` naming the hook whose ask was skipped, or
 *   empty when the default asked;
 * - the skip message ({@link unattendedSkipMessage}) as the result and no
 *   error, the shape Cursor's boundary stamps for the same skip
 *   (`stampUnattendedSkippedToolCalls`): a skip, not a failure.
 *
 * `approval_action` / `approved_by` are deliberately NOT touched — those
 * record HUMAN decisions only (the runtime's seed copies the answer from the
 * session's log). No
 * approval-request event exists for these calls, so the pending-approvals
 * projection stays empty by construction. Idempotent: re-running re-resolves
 * identically. Covers sub-agent transcripts because sub-agent gates inherit
 * the parent's registry instance.
 *
 * The registry is each harness's own evidence (the native gate's, the
 * Claude gate's), so each harness's settle calls this after its stream; the
 * fold itself is one rule for both.
 */
export function reconcileUnattendedSkips(
  rows: Pick<TurnRows, "messages" | "subAgentRuns">,
  unattendedSkips: ReadonlyMap<string, string | null> | undefined,
): void {
  if (!unattendedSkips || unattendedSkips.size === 0) return;

  const apply = (messages: readonly AgentMessage[]): void => {
    for (const msg of messages) {
      for (const tc of msg.toolCalls) {
        if (!unattendedSkips.has(tc.id)) continue;
        tc.status = ToolCallStatus.TOOL_CALL_SKIPPED;
        tc.approvalPolicySource = ApprovalPolicySource.UNATTENDED_SKIP;
        tc.approvalPolicyHook = unattendedSkips.get(tc.id) ?? "";
        tc.policyEngineVersion = POLICY_ENGINE_VERSION;
        tc.isStreaming = false;
        tc.error = "";
        tc.result = unattendedSkipMessage(tc.name);
      }
    }
  };

  apply(rows.messages);
  for (const subAgent of rows.subAgentRuns) {
    apply(subAgent.messages);
  }
}

/**
 * The runtime's one reader and one settler of a user's approval decision.
 *
 * A decision lives on the tool-call row the server owns
 * (`ToolCall.approval_action`, written by `SubmitApproval`); the runtime
 * reads it at the start of a reinvocation and settles the rows that never
 * run at the end of it. Both acts are here so the two halves of one
 * transition cannot drift apart:
 *
 *  - {@link approvalDecisionsOf} reads every top-level row still
 *    WAITING_APPROVAL whose action is set. The WAITING filter is what keeps a
 *    decided row from being re-gated on the NEXT reinvocation (its row is
 *    COMPLETED or SKIPPED by then) and what lets the adapter still describe
 *    the decision to its engine on THIS one (Cursor's reinvocation prompt
 *    names the skipped and rejected actions in human terms).
 *  - {@link terminalizeNonExecutingDecisions} settles SKIP and REJECT rows to
 *    TOOL_CALL_SKIPPED (REJECT also carries `error: "Rejected by user"`),
 *    root and sub-agent transcripts alike. The runtime calls it once,
 *    immediately after `adapter.runTurn` returns and before any persist of
 *    the outcome, for EVERY outcome: a decision that never runs the tool has
 *    no engine event to flip its row, so the row would otherwise persist
 *    WAITING on a completed execution. APPROVE and APPROVE_ALL are not
 *    touched — the tool executes, and the adapter's own events settle it.
 *
 * Why after the adapter, not before: both readers above filter on WAITING, so
 * stamping first would hide the decision from the reinvocation prompt and
 * from the exact-apply. Why by decision and not by row status: the outcome
 * of SKIP and REJECT is fully determined by the recorded decision, whatever
 * transient status an engine left (a denial ToolMessage with no tool events,
 * or a replay that never re-drove the gate), so the stamp is idempotent and
 * checkpointer-independent by construction. REJECT and SKIP share SKIPPED as
 * the terminal status (the tool did not run) and stay distinguishable by
 * `approval_action` and by the server's append-only approval-event stream.
 *
 * This is the contract as of stigmer#197: REJECT denies the tool and the run
 * CONTINUES; it never fails the execution. The native harness proved it
 * (`hitl.ts` `reconcileNonExecutingDecisions`, moved here at S3 M1) and the
 * conformance suite (`agentexecution-approval.conformance.test.ts`) is its
 * arbiter for both harnesses.
 */

import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ApprovalAction, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/** The row's error for a REJECT; byte-pinned by the native goldens (`reject.turn2.status.json`) and the conformance suite. */
export const REJECTED_BY_USER_ERROR = "Rejected by user";

/**
 * Every top-level tool-call row still WAITING_APPROVAL whose `approvalAction`
 * the server has set, keyed by tool-call id, in transcript order. Derived
 * from the status on every invocation, never stored, so it cannot drift from
 * the rows. The same rows, in the same order, that the Cursor adapter's
 * `reconstructAdjudicatedApprovals` reads for its own facts (the
 * pending-approval protos and content digests); a test pins the two
 * readers' agreement.
 */
export function approvalDecisionsOf(status: AgentExecutionStatus): ReadonlyMap<string, ApprovalAction> {
  const decisions = new Map<string, ApprovalAction>();
  for (const message of status.messages) {
    for (const row of message.toolCalls) {
      if (row.status !== ToolCallStatus.TOOL_CALL_WAITING_APPROVAL) continue;
      if (row.approvalAction === ApprovalAction.UNSPECIFIED) continue;
      decisions.set(row.id, row.approvalAction);
    }
  }
  return decisions;
}

/**
 * Settle every SKIP and REJECT row to TOOL_CALL_SKIPPED, root and sub-agent
 * transcripts, in place. Idempotent: a row already settled carries the same
 * decision and re-settles identically. A REJECT row's `error` is set only
 * when empty, so an engine's own denial text, if any, stands.
 */
export function terminalizeNonExecutingDecisions(status: AgentExecutionStatus): void {
  const settle = (messages: readonly AgentMessage[]): void => {
    for (const message of messages) {
      for (const row of message.toolCalls) {
        switch (row.approvalAction) {
          case ApprovalAction.SKIP:
            row.status = ToolCallStatus.TOOL_CALL_SKIPPED;
            break;
          case ApprovalAction.REJECT:
            row.status = ToolCallStatus.TOOL_CALL_SKIPPED;
            if (!row.error) row.error = REJECTED_BY_USER_ERROR;
            break;
          case ApprovalAction.UNSPECIFIED:
          case ApprovalAction.APPROVE:
          case ApprovalAction.APPROVE_ALL:
            break;
          default: {
            const exhaustive: never = row.approvalAction;
            throw new Error(`terminalizeNonExecutingDecisions: unknown approval action ${String(exhaustive)}`);
          }
        }
      }
    }
  };
  settle(status.messages);
  for (const subAgent of status.subAgentExecutions) {
    settle(subAgent.messages);
  }
}

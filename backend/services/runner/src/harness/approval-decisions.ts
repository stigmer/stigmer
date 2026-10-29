/**
 * The runtime's one settler of a person's approval decision.
 *
 * A decision is read at the start of a reinvocation from the session's log
 * (`approval-answers.ts`, the door), onto the root rows still
 * WAITING_APPROVAL: the WAITING filter is what keeps a decided row from
 * being re-gated on the NEXT reinvocation (its row is COMPLETED or SKIPPED
 * by then) and what lets the adapter still answer the call its engine
 * resumes onto on THIS one. The rows are the runtime's working memory: the seed
 * copies each call's answer from the log onto its row
 * (`ToolCall.approval_action`, `approval-answers.ts` `copyAnswersOntoRows`),
 * so the field this module settles by is the log's answer, never a server
 * stamp:
 *
 *  - {@link terminalizeNonExecutingDecisions} settles SKIP and REJECT rows to
 *    TOOL_CALL_SKIPPED (REJECT also carries `error: "Rejected by user"`),
 *    root and sub-agent transcripts alike. The runtime calls it once,
 *    immediately after `adapter.runTurn` returns and before any persist of
 *    the outcome, for EVERY outcome: a decision that never runs the tool has
 *    no engine event to flip its row, so the row would otherwise persist
 *    WAITING on a completed execution. APPROVE and APPROVE_ALL are not
 *    touched — the tool executes, and the adapter's own events settle it.
 *
 * Why after the adapter, not before: the door filters on WAITING, so
 * settling first would hide the decision from the reinvocation prompt. Why
 * by decision and not by row status: the outcome
 * of SKIP and REJECT is fully determined by the recorded decision, whatever
 * transient status an engine left (a denial ToolMessage with no tool events,
 * or a replay that never re-drove the gate), so the stamp is idempotent and
 * checkpointer-independent by construction. REJECT and SKIP share SKIPPED as
 * the terminal status (the tool did not run) and stay distinguishable by
 * `approval_action` and by the answer in the session's log.
 *
 * This is the contract as of stigmer#197: REJECT denies the tool and the run
 * CONTINUES; it never fails the execution. The Stigmer harness proved it
 * (`hitl.ts` `reconcileNonExecutingDecisions`, moved here in #1096) and the
 * conformance suite (`run-approval.conformance.test.ts`) is its
 * arbiter for both harnesses.
 */

import type { AgentMessage, TurnRows } from "../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { ApprovalAction, ToolCallStatus } from "../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

/** The row's error for a REJECT; byte-pinned by the Stigmer goldens (`reject.turn2.status.json`) and the conformance suite. */
export const REJECTED_BY_USER_ERROR = "Rejected by user";

/**
 * Settle every SKIP and REJECT row to TOOL_CALL_SKIPPED, root and sub-agent
 * transcripts, in place. Idempotent: a row already settled carries the same
 * decision and re-settles identically. A REJECT row's `error` is set only
 * when empty, so an engine's own denial text, if any, stands.
 */
export function terminalizeNonExecutingDecisions(rows: Pick<TurnRows, "messages" | "subAgentRuns">): void {
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
  settle(rows.messages);
  for (const subAgent of rows.subAgentRuns) {
    settle(subAgent.messages);
  }
}

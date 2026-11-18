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
 *    WAITING on a completed execution.
 *  - An APPROVE or APPROVE_ALL row is the engine's to settle: the resumed
 *    engine runs the call, and the adapter's own events flip its row. No
 *    engine can promise that, though: the Claude engine has been seen to
 *    resume, tell its model the approved call was interrupted, and finish
 *    without running it (stigmer#2915; anthropics/claude-agent-sdk-typescript#532),
 *    and nothing then settles the row, so the person's card waits forever on
 *    a finished conversation. So once the turn's outcome ends the run
 *    (`completed`, `failed`, `tool_call_limit`), an approved row still
 *    WAITING is a call that did not run, and it settles TOOL_CALL_FAILED
 *    with {@link APPROVED_NOT_RUN_ERROR}, the row shape of an approved call
 *    that failed. Not after `awaiting_approval` (the rows the turn just
 *    proposed are owed an answer) nor after `interrupted` (a yield's next
 *    invocation resumes that very row by its WAITING status). The function
 *    returns those ids, so the runtime logs each recurrence; it writes
 *    nothing but the rows.
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

import type { AgentMessage, ToolCall, TurnRows } from "../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { ApprovalAction, ToolCallStatus } from "../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import type { TurnOutcome } from "./types.js";

/** The row's error for a REJECT; byte-pinned by the Stigmer goldens (`reject.turn2.status.json`) and the conformance suite. */
export const REJECTED_BY_USER_ERROR = "Rejected by user";

/** The row's error for an approved call the engine never ran: what the person's card says instead of waiting forever. */
export const APPROVED_NOT_RUN_ERROR = "You approved this, but it did not run. Ask the agent to run it again.";

/**
 * Settle the decisions that did not execute, root and sub-agent transcripts,
 * in place: every SKIP and REJECT row to TOOL_CALL_SKIPPED, on every outcome;
 * and, once `outcome` ends the run, every approved row still WAITING to
 * TOOL_CALL_FAILED. Returns the ids of those approved calls. Idempotent: a
 * row already settled carries the same decision and re-settles identically,
 * and a settled approved row is no longer WAITING. An error is set only when
 * the row has none, so an engine's own text, if any, stands.
 */
export function terminalizeNonExecutingDecisions(rows: Pick<TurnRows, "messages" | "subAgentRuns">, outcome: TurnOutcome["kind"]): string[] {
  const runEnded = endsTheRun(outcome);
  const notRun: string[] = [];
  const settleApproved = (row: ToolCall): void => {
    if (!runEnded || row.status !== ToolCallStatus.TOOL_CALL_WAITING_APPROVAL) return;
    row.status = ToolCallStatus.TOOL_CALL_FAILED;
    if (!row.error) row.error = APPROVED_NOT_RUN_ERROR;
    notRun.push(row.id);
  };
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
          case ApprovalAction.APPROVE:
          case ApprovalAction.APPROVE_ALL:
            settleApproved(row);
            break;
          case ApprovalAction.UNSPECIFIED:
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
  return notRun;
}

/** Whether nothing of this run executes after an outcome of this kind, so an approved call still waiting will never run. */
function endsTheRun(outcome: TurnOutcome["kind"]): boolean {
  switch (outcome) {
    case "completed":
    case "failed":
    case "tool_call_limit":
      return true;
    case "awaiting_approval":
    case "interrupted":
      return false;
    /* v8 ignore start -- @preserve: the never arm; the compiler proves no outcome kind reaches it */
    default: {
      const exhaustive: never = outcome;
      throw new Error(`terminalizeNonExecutingDecisions: unknown turn outcome ${String(exhaustive)}`);
    }
    /* v8 ignore stop */
  }
}

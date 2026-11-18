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
 * stamp. Two settles, split by what each depends on:
 *
 *  - {@link terminalizeNonExecutingDecisions} settles SKIP and REJECT rows to
 *    TOOL_CALL_SKIPPED (REJECT also carries `error: "Rejected by user"`),
 *    root and sub-agent transcripts alike. Their outcome is the decision's
 *    alone, so it holds on every outcome: the runtime calls it once,
 *    immediately after `adapter.runTurn` returns and before any persist of
 *    the outcome. A decision that never runs the tool has no engine event to
 *    flip its row, so the row would otherwise persist WAITING on a
 *    completed execution.
 *  - {@link settleApprovedNotRun} settles an APPROVE or APPROVE_ALL row
 *    still WAITING to TOOL_CALL_FAILED with {@link APPROVED_NOT_RUN_ERROR},
 *    the row shape of an approved call that failed. Its outcome depends on
 *    whether the run is over, which only the runtime knows. The invariant:
 *    a run that is complete has no approved call still waiting. An approved
 *    row is the engine's to settle, the resumed engine runs the call and the
 *    adapter's own events flip its row, but nothing promises the run gets
 *    that far. The Claude engine has been seen to resume, tell its model the
 *    approved call was interrupted, and finish without running it
 *    (stigmer#2915; anthropics/claude-agent-sdk-typescript#532); a stall, the
 *    operation limit, a cost cap, a platform stop, or a refusal or a fault
 *    after the answers are copied ends the run first (stigmer#3277). Nothing
 *    outside the runner settles such a row, so the person's card would wait
 *    forever on a run that is over. The adapter cannot tell: its
 *    `interrupted` is a stop the runtime classifies into an arm, and some arms
 *    end the run while others hand it on. So the runtime calls this at its
 *    two completion writers (`run-turn.ts`): `settleWith` when the terminal
 *    arm `completes` (`terminal-table.ts`, the table's own answer to "is
 *    the run over"), and `completeTurn`. An arm that does not complete (a
 *    wait for approval, a pause, a drain, a restart, a continue) leaves the
 *    row WAITING, because the invocation that resumes the run resumes that
 *    very call by its WAITING status. It returns the ids it settled, so the
 *    runtime logs each recurrence; it writes nothing but the rows.
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

/** The row's error for a REJECT; byte-pinned by the Stigmer goldens (`reject.turn2.status.json`) and the conformance suite. */
export const REJECTED_BY_USER_ERROR = "Rejected by user";

/** The row's error for an approved call the engine never ran: what the person's card says instead of waiting forever. */
export const APPROVED_NOT_RUN_ERROR = "You approved this, but it did not run. Ask the agent to run it again.";

/** The rows both settles walk: the root transcript and every sub-agent's. */
type SettledRows = Pick<TurnRows, "messages" | "subAgentRuns">;

/** Every tool-call row of `rows`, root and sub-agent transcripts alike. */
function* toolCallRows(rows: SettledRows): Generator<ToolCall> {
  const transcripts: (readonly AgentMessage[])[] = [rows.messages, ...rows.subAgentRuns.map((subAgent) => subAgent.messages)];
  for (const messages of transcripts) {
    for (const message of messages) yield* message.toolCalls;
  }
}

/**
 * Settle the decisions that never run the tool, in place: every SKIP and
 * REJECT row to TOOL_CALL_SKIPPED, on every outcome. Approved rows are
 * {@link settleApprovedNotRun}'s. Idempotent: a row already settled carries
 * the same decision and re-settles identically. An error is set only when
 * the row has none, so an engine's own text, if any, stands.
 */
export function terminalizeNonExecutingDecisions(rows: SettledRows): void {
  for (const row of toolCallRows(rows)) {
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
      case ApprovalAction.UNSPECIFIED:
        break;
      /* v8 ignore start -- @preserve: the never arm; the compiler proves no approval action reaches it */
      default: {
        const exhaustive: never = row.approvalAction;
        throw new Error(`terminalizeNonExecutingDecisions: unknown approval action ${String(exhaustive)}`);
      }
      /* v8 ignore stop */
    }
  }
}

/**
 * Settle the approved calls of a run that has ended, in place: every APPROVE
 * or APPROVE_ALL row still WAITING to TOOL_CALL_FAILED with
 * {@link APPROVED_NOT_RUN_ERROR}, root and sub-agent transcripts alike.
 * Called only once the run is over (the module header says where). Returns
 * the ids it settled. Idempotent: a settled row is no longer WAITING. An
 * error is set only when the row has none, so an engine's own text, if any,
 * stands.
 */
export function settleApprovedNotRun(rows: SettledRows): string[] {
  const notRun: string[] = [];
  for (const row of toolCallRows(rows)) {
    const approved = row.approvalAction === ApprovalAction.APPROVE || row.approvalAction === ApprovalAction.APPROVE_ALL;
    if (!approved || row.status !== ToolCallStatus.TOOL_CALL_WAITING_APPROVAL) continue;
    row.status = ToolCallStatus.TOOL_CALL_FAILED;
    if (!row.error) row.error = APPROVED_NOT_RUN_ERROR;
    notRun.push(row.id);
  }
  return notRun;
}

/**
 * The HITL resume gate. One lifecycle blocks a turn: its asks. File
 * review never does: a turn with review on ends normally with its edits
 * applied, and its change sets are decided after it (stigmer#1471 is the
 * turn that waited for a review only Stigmer's console could give).
 *
 * The gate is the turn's open asks in its session's log: a tool use the
 * runner wrote with evaluated_permission `ask` that no
 * user.tool_confirmation and no result of the same run has closed
 * (domain/session/events/gates.ts). The workflow counts them with the
 * CountOpenGates activity (store/session-events.ts `openGates`); an answer
 * counts them under the lock it records with
 * (domain/session/hitl/answer.ts `openAsksOf`). One fact, so the workflow's
 * wake condition and an answer's signal can never disagree about whether
 * the turn may resume.
 */

/** Whether the HITL gate is clear — the turn may resume: none of its asks is open. */
export function gateResolved(openGates: number): boolean {
  return openGates === 0;
}

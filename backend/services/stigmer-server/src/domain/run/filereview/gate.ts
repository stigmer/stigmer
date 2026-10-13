/**
 * The HITL resume gate — ports filereview/gate.go. One lifecycle blocks a
 * turn: its asks. File review never does: a turn with review on ends
 * normally with its edits applied, and its change sets are decided after
 * it (stigmer#1471 is the turn that waited for a review only Stigmer's
 * console could give).
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
 *
 * `unresolvedGateCount` is the gate as a run's pending approvals stated
 * it, kept for a history that replays its load of the run
 * (OPEN_GATES_FROM_LOG_PATCH_ID in temporal/agentexecution/names.ts). A
 * run's pending approvals are its waiting rows whose ask is open
 * (../approval/pending.ts), so on a run whose rows were written the two
 * counts agree.
 *
 * Bundle-safe: the invoke workflow imports this module by direct path.
 */
import type { RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";

/** The gate a replayed history read: the run's pending approvals (module header). */
export function unresolvedGateCount(status: RunStatus): number {
  return status.pendingApprovals.length;
}

/** Whether the HITL gate is clear — the turn may resume: none of its asks is open. */
export function gateResolved(openGates: number): boolean {
  return openGates === 0;
}

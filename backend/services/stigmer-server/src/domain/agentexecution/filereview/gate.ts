/**
 * The unified HITL resume gate — ports filereview/gate.go. Two lifecycles
 * can block a single turn: tool approvals (pending_approvals) and file
 * review (file_change_sets awaiting a human decision); a turn is
 * unblocked only when BOTH are clear. These helpers are the one place
 * that truth is computed, so the workflow's wake condition,
 * SubmitApproval's signal, and SubmitFileDecision's signal can never
 * disagree about whether the turn may resume.
 */
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { FileChangeSetStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";

/**
 * How many change sets still wait on a human decision (AWAITING_REVIEW).
 * A CAPTURING set is mid-turn (the runner has not returned yet) and a
 * DECIDED/RECONCILED/FAILED set no longer blocks the gate, so neither
 * counts.
 */
export function countAwaitingReview(changeSets: FileChangeSet[]): number {
  let n = 0;
  for (const cs of changeSets) {
    if (cs.status === FileChangeSetStatus.AWAITING_REVIEW) {
      n++;
    }
  }
  return n;
}

/** Whether the file-review sub-gate is clear. */
export function noChangeSetAwaitingReview(
  status: AgentExecutionStatus,
): boolean {
  return countAwaitingReview(status.fileChangeSets) === 0;
}

/**
 * The size of the combined HITL gate: tool calls still awaiting approval
 * plus change sets still awaiting review. The workflow waits while this
 * is > 0 and re-invokes the runner once it reaches 0.
 */
export function unresolvedGateCount(status: AgentExecutionStatus): number {
  return (
    status.pendingApprovals.length +
    countAwaitingReview(status.fileChangeSets)
  );
}

/** Whether the combined HITL gate is fully clear — the turn may resume. */
export function gateResolved(status: AgentExecutionStatus): boolean {
  return unresolvedGateCount(status) === 0;
}

/**
 * Whether some change set is DECIDED — verdicts recorded, runner
 * reconcile still owed. The workflow's wait loop uses this to tell a
 * LEGITIMATE empty gate from a broken one (a set decided before the gate
 * check — the DD-28 auto-keep or a fast human — leaves phase
 * WAITING_FOR_APPROVAL with a zero gate count; the correct response is an
 * immediate re-invoke to reconcile, never the empty-gate anomaly path).
 */
export function hasDecidedAwaitingReconcile(
  status: AgentExecutionStatus,
): boolean {
  return status.fileChangeSets.some(
    (cs) => cs.status === FileChangeSetStatus.DECIDED,
  );
}

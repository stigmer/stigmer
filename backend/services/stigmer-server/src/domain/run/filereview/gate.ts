/**
 * The HITL resume gate — ports filereview/gate.go. One lifecycle blocks a
 * turn: tool approvals (pending_approvals). File review never does: a turn
 * with review on ends normally with its edits applied, and its change sets
 * are decided after it (stigmer#1471 is the turn that waited for a review
 * only Stigmer's console could give). These helpers are the one place the
 * gate is computed, so the workflow's wake condition and SubmitApproval's
 * signal can never disagree about whether the turn may resume.
 *
 * Bundle-safe: the invoke workflow imports this module by direct path.
 */
import type { RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";

/**
 * The size of the HITL gate: tool calls still awaiting approval. The
 * workflow waits while this is > 0 and re-invokes the runner once it
 * reaches 0.
 */
export function unresolvedGateCount(status: RunStatus): number {
  return status.pendingApprovals.length;
}

/** Whether the HITL gate is clear — the turn may resume. */
export function gateResolved(status: RunStatus): boolean {
  return unresolvedGateCount(status) === 0;
}

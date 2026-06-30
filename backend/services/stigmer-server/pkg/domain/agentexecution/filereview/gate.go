package filereview

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// The HITL resume gate is UNIFIED across two lifecycles that can both block a
// single turn: tool approvals (pending_approvals) and file review
// (file_change_sets awaiting a human decision). A turn is unblocked only when
// BOTH are clear. These helpers are the one place that truth is computed, so the
// workflow's wake condition, SubmitApproval's signal, and SubmitFileDecision's
// signal can never disagree about whether the turn may resume.

// CountAwaitingReview returns how many change sets are still waiting on a human
// decision (status AWAITING_REVIEW). A set that is CAPTURING is mid-turn (the
// runner has not returned yet) and a DECIDED/RECONCILED/FAILED set no longer
// blocks the gate, so neither counts.
func CountAwaitingReview(changeSets []*agentexecutionv1.FileChangeSet) int {
	n := 0
	for _, cs := range changeSets {
		if cs.GetStatus() == agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW {
			n++
		}
	}
	return n
}

// NoChangeSetAwaitingReview reports whether the file-review sub-gate is clear:
// no change set is waiting on a human decision.
func NoChangeSetAwaitingReview(status *agentexecutionv1.AgentExecutionStatus) bool {
	return CountAwaitingReview(status.GetFileChangeSets()) == 0
}

// UnresolvedGateCount is the size of the combined HITL gate: the number of tool
// calls still awaiting approval plus the number of change sets still awaiting
// review. The workflow waits while this is > 0 and re-invokes the runner once it
// reaches 0. Reading both sub-gates here (rather than pending_approvals alone)
// is what lets a turn blocked purely on file review wait for, and resume from,
// the same signal as tool approvals.
func UnresolvedGateCount(status *agentexecutionv1.AgentExecutionStatus) int {
	return len(status.GetPendingApprovals()) + CountAwaitingReview(status.GetFileChangeSets())
}

// GateResolved reports whether the combined HITL gate is fully clear — no
// pending approvals AND no change set awaiting review — so the turn may resume.
func GateResolved(status *agentexecutionv1.AgentExecutionStatus) bool {
	return UnresolvedGateCount(status) == 0
}

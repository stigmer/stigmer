package filereview

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

func changeSet(status agentexecutionv1.FileChangeSetStatus) *agentexecutionv1.FileChangeSet {
	return &agentexecutionv1.FileChangeSet{Status: status}
}

func pendingApproval() *agentexecutionv1.PendingApproval {
	return &agentexecutionv1.PendingApproval{}
}

// TestUnifiedGate_TruthTable exercises every combination of the two sub-gates,
// the contract the whole unified-gate design rests on: the turn resumes only
// when BOTH pending approvals and file review are clear.
func TestUnifiedGate_TruthTable(t *testing.T) {
	awaiting := agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW
	decided := agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_DECIDED

	cases := []struct {
		name          string
		approvals     []*agentexecutionv1.PendingApproval
		changeSets    []*agentexecutionv1.FileChangeSet
		wantGateCount int
		wantResolved  bool
	}{
		{
			name:          "neither pending — gate resolved",
			wantGateCount: 0,
			wantResolved:  true,
		},
		{
			name:          "approvals only",
			approvals:     []*agentexecutionv1.PendingApproval{pendingApproval()},
			wantGateCount: 1,
			wantResolved:  false,
		},
		{
			name:          "file review only",
			changeSets:    []*agentexecutionv1.FileChangeSet{changeSet(awaiting)},
			wantGateCount: 1,
			wantResolved:  false,
		},
		{
			name:          "both pending",
			approvals:     []*agentexecutionv1.PendingApproval{pendingApproval()},
			changeSets:    []*agentexecutionv1.FileChangeSet{changeSet(awaiting), changeSet(awaiting)},
			wantGateCount: 3,
			wantResolved:  false,
		},
		{
			name:          "decided change set does not block",
			changeSets:    []*agentexecutionv1.FileChangeSet{changeSet(decided)},
			wantGateCount: 0,
			wantResolved:  true,
		},
		{
			name:          "approvals clear but file review still awaiting",
			changeSets:    []*agentexecutionv1.FileChangeSet{changeSet(awaiting), changeSet(decided)},
			wantGateCount: 1,
			wantResolved:  false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status := &agentexecutionv1.AgentExecutionStatus{
				PendingApprovals: tc.approvals,
				FileChangeSets:   tc.changeSets,
			}
			if got := UnresolvedGateCount(status); got != tc.wantGateCount {
				t.Errorf("UnresolvedGateCount = %d, want %d", got, tc.wantGateCount)
			}
			if got := GateResolved(status); got != tc.wantResolved {
				t.Errorf("GateResolved = %v, want %v", got, tc.wantResolved)
			}
			if got := NoChangeSetAwaitingReview(status); got != (CountAwaitingReview(tc.changeSets) == 0) {
				t.Errorf("NoChangeSetAwaitingReview inconsistent with CountAwaitingReview")
			}
		})
	}
}

func TestGateHelpers_NilStatusSafe(t *testing.T) {
	var status *agentexecutionv1.AgentExecutionStatus
	if UnresolvedGateCount(status) != 0 {
		t.Errorf("UnresolvedGateCount(nil) should be 0")
	}
	if !GateResolved(status) {
		t.Errorf("GateResolved(nil) should be true (nothing pending)")
	}
}

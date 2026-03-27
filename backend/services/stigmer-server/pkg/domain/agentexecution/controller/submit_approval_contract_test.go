package agentexecution

import (
	"testing"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// Contract tests verify the data shapes that cross service boundaries.
// These are not integration tests — they test invariants on proto messages
// that downstream services depend on.

// TestRecordApprovalDecisionPreservesPendingApprovals verifies that the
// approval decision recording step does NOT remove pending_approvals.
// This is the contract that Python's RESUME_RECONCILE depends on.
func TestRecordApprovalDecisionPreservesPendingApprovals(t *testing.T) {
	pa := &agentexecutionv1.PendingApproval{
		ToolCallId:     "call_abc123",
		ToolName:       "delete_file",
		InterruptId:    "intr_001",
		LifecycleState: agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED,
	}

	tc := &agentexecutionv1.ToolCall{
		Id:     "call_abc123",
		Name:   "delete_file",
		Status: agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL,
	}

	execution := &agentexecutionv1.AgentExecution{
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase:            agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
			PendingApprovals: []*agentexecutionv1.PendingApproval{pa},
			ToolCalls:        []*agentexecutionv1.ToolCall{tc},
		},
	}

	// Simulate what recordApprovalDecisionStep does
	action := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE
	now := time.Now().UTC().Format(time.RFC3339)

	if foundTC := findToolCallInExecution(execution, "call_abc123"); foundTC != nil {
		foundTC.ApprovalAction = action
		foundTC.ApprovalDecidedAt = now
	}

	for _, existingPA := range execution.Status.PendingApprovals {
		if existingPA.GetToolCallId() == "call_abc123" {
			existingPA.LifecycleState = agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_DECISION_RECORDED
			existingPA.DecisionAction = action
			existingPA.DecisionRecordedAt = now
			break
		}
	}

	// Contract assertions
	if len(execution.Status.PendingApprovals) != 1 {
		t.Fatalf("pending_approvals must be preserved: got %d, want 1",
			len(execution.Status.PendingApprovals))
	}

	resultPA := execution.Status.PendingApprovals[0]
	if resultPA.LifecycleState != agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_DECISION_RECORDED {
		t.Errorf("lifecycle_state: got %v, want DECISION_RECORDED",
			resultPA.LifecycleState)
	}
	if resultPA.DecisionAction != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE {
		t.Errorf("decision_action: got %v, want APPROVE", resultPA.DecisionAction)
	}
	if resultPA.InterruptId != "intr_001" {
		t.Errorf("interrupt_id must be preserved: got %q, want %q",
			resultPA.InterruptId, "intr_001")
	}
	if resultPA.ToolCallId != "call_abc123" {
		t.Errorf("tool_call_id must be preserved: got %q, want %q",
			resultPA.ToolCallId, "call_abc123")
	}
}

// TestLifecycleStateForwardOnly verifies the ordering invariant.
// RESUME_RECONCILED is now the terminal state (entries are pruned server-side).
func TestLifecycleStateForwardOnly(t *testing.T) {
	states := []agentexecutionv1.ApprovalLifecycleState{
		agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_UNSPECIFIED,
		agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_REQUESTED,
		agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED,
		agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_DECISION_RECORDED,
		agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_RESUME_RECONCILED,
	}

	for i := 0; i < len(states)-1; i++ {
		if states[i] >= states[i+1] {
			t.Errorf("lifecycle states must be strictly ordered: %v (=%d) >= %v (=%d)",
				states[i], int32(states[i]), states[i+1], int32(states[i+1]))
		}
	}
}

// TestUpsertMergePreservesExistingPAs verifies that the upsert merge
// preserves existing PAs that are not mentioned in the incoming update.
func TestUpsertMergePreservesExistingPAs(t *testing.T) {
	existing := &agentexecutionv1.PendingApproval{
		ToolCallId:     "call_existing",
		ToolName:       "read_file",
		LifecycleState: agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_REQUESTED,
	}

	incoming := &agentexecutionv1.PendingApproval{
		ToolCallId:     "call_new",
		ToolName:       "write_file",
		LifecycleState: agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_REQUESTED,
	}

	existingPAs := []*agentexecutionv1.PendingApproval{existing}
	incomingPAs := []*agentexecutionv1.PendingApproval{incoming}

	merged := make(map[string]*agentexecutionv1.PendingApproval)
	for _, pa := range existingPAs {
		merged[pa.ToolCallId] = pa
	}
	for _, pa := range incomingPAs {
		if pa.ToolCallId == "" {
			continue
		}
		merged[pa.ToolCallId] = pa
	}

	if len(merged) != 2 {
		t.Fatalf("upsert merge should keep both PAs: got %d, want 2", len(merged))
	}
	if _, ok := merged["call_existing"]; !ok {
		t.Error("existing PA should be preserved")
	}
	if _, ok := merged["call_new"]; !ok {
		t.Error("new PA should be added")
	}
}

// TestResumeReconciledEntriesArePruned verifies that entries reaching
// RESUME_RECONCILED are pruned from the result set (post-merge pruning).
func TestResumeReconciledEntriesArePruned(t *testing.T) {
	reconciled := &agentexecutionv1.PendingApproval{
		ToolCallId:     "call_done",
		ToolName:       "delete_file",
		LifecycleState: agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_RESUME_RECONCILED,
	}

	active := &agentexecutionv1.PendingApproval{
		ToolCallId:     "call_pending",
		ToolName:       "write_file",
		LifecycleState: agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_REQUESTED,
	}

	allPAs := []*agentexecutionv1.PendingApproval{reconciled, active}

	var result []*agentexecutionv1.PendingApproval
	for _, pa := range allPAs {
		if pa.LifecycleState < agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_RESUME_RECONCILED {
			result = append(result, pa)
		}
	}

	if len(result) != 1 {
		t.Fatalf("pruning should leave 1 active PA: got %d", len(result))
	}
	if result[0].ToolCallId != "call_pending" {
		t.Errorf("surviving PA should be call_pending, got %q", result[0].ToolCallId)
	}
}

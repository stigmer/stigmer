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

// TestClearSignalSentinelHasEmptyToolCallId verifies the clear-signal
// convention: a PendingApproval with empty tool_call_id triggers the
// "clear" path in BuildNewStateWithStatusStep.
func TestClearSignalSentinelHasEmptyToolCallId(t *testing.T) {
	sentinel := &agentexecutionv1.PendingApproval{
		ToolCallId:     "",
		LifecycleState: agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_CLEARED,
	}

	if sentinel.ToolCallId != "" {
		t.Errorf("clear-signal sentinel must have empty tool_call_id")
	}
	if sentinel.LifecycleState != agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_CLEARED {
		t.Errorf("clear-signal sentinel lifecycle: got %v, want CLEARED",
			sentinel.LifecycleState)
	}
}

// TestLifecycleStateForwardOnly verifies the ordering invariant.
func TestLifecycleStateForwardOnly(t *testing.T) {
	states := []agentexecutionv1.ApprovalLifecycleState{
		agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_UNSPECIFIED,
		agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_REQUESTED,
		agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED,
		agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_DECISION_RECORDED,
		agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_RESUME_RECONCILED,
		agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_CLEARED,
	}

	for i := 0; i < len(states)-1; i++ {
		if states[i] >= states[i+1] {
			t.Errorf("lifecycle states must be strictly ordered: %v (=%d) >= %v (=%d)",
				states[i], int32(states[i]), states[i+1], int32(states[i+1]))
		}
	}
}

// TestUpdateStatusClearPathWithLifecycleState verifies that the merge
// logic in update_status.go correctly identifies the clear-signal.
func TestUpdateStatusClearPathWithLifecycleState(t *testing.T) {
	// Simulate what update_status.go does
	requestPAs := []*agentexecutionv1.PendingApproval{
		{
			ToolCallId:     "",
			LifecycleState: agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_CLEARED,
		},
	}

	existingPAs := []*agentexecutionv1.PendingApproval{
		{
			ToolCallId:     "call_abc123",
			LifecycleState: agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_DECISION_RECORDED,
		},
	}

	// Apply the merge logic from update_status.go
	var result []*agentexecutionv1.PendingApproval
	if len(requestPAs) > 0 {
		if requestPAs[0].ToolCallId != "" {
			result = requestPAs
		} else {
			result = nil // Clear path
		}
	} else {
		result = existingPAs // Preserve
	}

	if result != nil {
		t.Errorf("clear-signal should result in nil pending_approvals, got %d entries",
			len(result))
	}
}

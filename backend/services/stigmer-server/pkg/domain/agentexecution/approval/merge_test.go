package approval

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

func pa(toolCallID string, state agentexecutionv1.ApprovalLifecycleState) *agentexecutionv1.PendingApproval {
	return &agentexecutionv1.PendingApproval{
		ToolCallId:     toolCallID,
		ToolName:       "test_tool",
		LifecycleState: state,
	}
}

func TestMergePendingApprovals_EmptyIncomingPreservesExisting(t *testing.T) {
	existing := []*agentexecutionv1.PendingApproval{
		pa("tc1", agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_REQUESTED),
	}

	result := MergePendingApprovals(existing, nil)
	if len(result) != 1 {
		t.Fatalf("expected 1, got %d", len(result))
	}
	if result[0].ToolCallId != "tc1" {
		t.Fatalf("expected tc1, got %s", result[0].ToolCallId)
	}
}

func TestMergePendingApprovals_EmptyListPreservesExisting(t *testing.T) {
	existing := []*agentexecutionv1.PendingApproval{
		pa("tc1", agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_REQUESTED),
	}

	result := MergePendingApprovals(existing, []*agentexecutionv1.PendingApproval{})
	if len(result) != 1 {
		t.Fatalf("expected 1, got %d", len(result))
	}
}

func TestMergePendingApprovals_NewPAAdded(t *testing.T) {
	existing := []*agentexecutionv1.PendingApproval{
		pa("tc1", agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_REQUESTED),
	}
	incoming := []*agentexecutionv1.PendingApproval{
		pa("tc2", agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_REQUESTED),
	}

	result := MergePendingApprovals(existing, incoming)
	if len(result) != 2 {
		t.Fatalf("expected 2, got %d", len(result))
	}
}

func TestMergePendingApprovals_ForwardOnlyLifecycle(t *testing.T) {
	existing := []*agentexecutionv1.PendingApproval{
		pa("tc1", agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_DECISION_RECORDED),
	}
	incoming := []*agentexecutionv1.PendingApproval{
		pa("tc1", agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_REQUESTED),
	}

	result := MergePendingApprovals(existing, incoming)
	if len(result) != 1 {
		t.Fatalf("expected 1, got %d", len(result))
	}
	if result[0].LifecycleState != agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_DECISION_RECORDED {
		t.Fatalf("expected DECISION_RECORDED, got %s", result[0].LifecycleState)
	}
}

func TestMergePendingApprovals_ForwardAdvance(t *testing.T) {
	existing := []*agentexecutionv1.PendingApproval{
		pa("tc1", agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_REQUESTED),
	}
	incoming := []*agentexecutionv1.PendingApproval{
		pa("tc1", agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED),
	}

	result := MergePendingApprovals(existing, incoming)
	if len(result) != 1 {
		t.Fatalf("expected 1, got %d", len(result))
	}
	if result[0].LifecycleState != agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED {
		t.Fatalf("expected INTERRUPT_CAPTURED, got %s", result[0].LifecycleState)
	}
}

func TestMergePendingApprovals_PrunesResumeReconciled(t *testing.T) {
	existing := []*agentexecutionv1.PendingApproval{
		pa("tc1", agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_DECISION_RECORDED),
	}
	incoming := []*agentexecutionv1.PendingApproval{
		pa("tc1", agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_RESUME_RECONCILED),
	}

	result := MergePendingApprovals(existing, incoming)
	if len(result) != 0 {
		t.Fatalf("expected 0 (pruned), got %d", len(result))
	}
}

func TestMergePendingApprovals_SkipsEmptyToolCallId(t *testing.T) {
	existing := []*agentexecutionv1.PendingApproval{
		pa("tc1", agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_REQUESTED),
	}
	incoming := []*agentexecutionv1.PendingApproval{
		{ToolCallId: "", LifecycleState: agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_RESUME_RECONCILED},
	}

	result := MergePendingApprovals(existing, incoming)
	if len(result) != 1 {
		t.Fatalf("expected 1 (sentinel skipped, existing preserved), got %d", len(result))
	}
	if result[0].ToolCallId != "tc1" {
		t.Fatalf("expected tc1, got %s", result[0].ToolCallId)
	}
}

func TestMergePendingApprovals_PreservesUnmentionedExisting(t *testing.T) {
	existing := []*agentexecutionv1.PendingApproval{
		pa("tc1", agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_REQUESTED),
		pa("tc2", agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED),
	}
	incoming := []*agentexecutionv1.PendingApproval{
		pa("tc1", agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED),
	}

	result := MergePendingApprovals(existing, incoming)
	if len(result) != 2 {
		t.Fatalf("expected 2, got %d", len(result))
	}
}

func TestMergePendingApprovals_NilExistingWithIncoming(t *testing.T) {
	incoming := []*agentexecutionv1.PendingApproval{
		pa("tc1", agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_REQUESTED),
	}

	result := MergePendingApprovals(nil, incoming)
	if len(result) != 1 {
		t.Fatalf("expected 1, got %d", len(result))
	}
}

func TestMergePendingApprovals_MixedPruneAndKeep(t *testing.T) {
	existing := []*agentexecutionv1.PendingApproval{
		pa("tc1", agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_DECISION_RECORDED),
		pa("tc2", agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_REQUESTED),
	}
	incoming := []*agentexecutionv1.PendingApproval{
		pa("tc1", agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_RESUME_RECONCILED),
		pa("tc2", agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED),
	}

	result := MergePendingApprovals(existing, incoming)
	if len(result) != 1 {
		t.Fatalf("expected 1 (tc1 pruned, tc2 kept), got %d", len(result))
	}
	if result[0].ToolCallId != "tc2" {
		t.Fatalf("expected tc2, got %s", result[0].ToolCallId)
	}
	if result[0].LifecycleState != agentexecutionv1.ApprovalLifecycleState_APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED {
		t.Fatalf("expected INTERRUPT_CAPTURED, got %s", result[0].LifecycleState)
	}
}

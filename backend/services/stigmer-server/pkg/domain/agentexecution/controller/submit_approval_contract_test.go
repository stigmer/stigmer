package agentexecution

import (
	"testing"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/approval"
)

// Contract tests verify the data shapes and invariants that cross service
// boundaries in the HITL approval flow. These are not integration tests —
// they exercise the pure functions and proto structures that downstream
// services (Python agent-runner, React SDK, CLI) depend on.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func makeApprovalToolCall(id, name string) *agentexecutionv1.ToolCall {
	return &agentexecutionv1.ToolCall{
		Id:                  id,
		Name:                name,
		Status:              agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL,
		RequiresApproval:    true,
		ApprovalMessage:     "Approve " + name + "?",
		ArgsPreview:         `{"path":"test.txt"}`,
		ApprovalRequestedAt: "2026-03-27T10:00:00Z",
	}
}

func makeAIMessageWithToolCalls(toolCalls ...*agentexecutionv1.ToolCall) *agentexecutionv1.AgentMessage {
	return &agentexecutionv1.AgentMessage{
		Type:      agentexecutionv1.MessageType_MESSAGE_AI,
		ToolCalls: toolCalls,
	}
}

func makeExecutionWithMessages(messages []*agentexecutionv1.AgentMessage, subAgents []*agentexecutionv1.SubAgentExecution) *agentexecutionv1.AgentExecution {
	return &agentexecutionv1.AgentExecution{
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase:              agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
			Messages:           messages,
			SubAgentExecutions: subAgents,
			PendingApprovals:   approval.ComputePendingApprovals(messages, subAgents),
		},
	}
}

// ---------------------------------------------------------------------------
// findToolCallInExecution
// ---------------------------------------------------------------------------

func TestFindToolCallInRootMessages(t *testing.T) {
	tc := makeApprovalToolCall("call_abc123", "delete_file")
	exec := makeExecutionWithMessages(
		[]*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(tc)},
		nil,
	)

	found := findToolCallInExecution(exec, "call_abc123")
	if found == nil {
		t.Fatal("expected to find tool call in root messages, got nil")
	}
	if found.GetId() != "call_abc123" {
		t.Errorf("found.Id = %q, want %q", found.GetId(), "call_abc123")
	}
}

func TestFindToolCallInSubAgentMessages(t *testing.T) {
	tc := makeApprovalToolCall("call_sub_001", "run_tests")
	exec := makeExecutionWithMessages(
		nil,
		[]*agentexecutionv1.SubAgentExecution{{
			Name:     "code-reviewer",
			Messages: []*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(tc)},
		}},
	)

	found := findToolCallInExecution(exec, "call_sub_001")
	if found == nil {
		t.Fatal("expected to find tool call in sub-agent messages, got nil")
	}
	if found.GetName() != "run_tests" {
		t.Errorf("found.Name = %q, want %q", found.GetName(), "run_tests")
	}
}

func TestFindToolCallReturnsNilWhenNotFound(t *testing.T) {
	tc := makeApprovalToolCall("call_abc123", "delete_file")
	exec := makeExecutionWithMessages(
		[]*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(tc)},
		nil,
	)

	found := findToolCallInExecution(exec, "call_nonexistent")
	if found != nil {
		t.Errorf("expected nil for non-existent tool_call_id, got %+v", found)
	}
}

func TestFindToolCallPrefersFirstMatch(t *testing.T) {
	rootTC := makeApprovalToolCall("call_shared_id", "root_tool")
	subTC := makeApprovalToolCall("call_shared_id", "sub_tool")

	exec := makeExecutionWithMessages(
		[]*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(rootTC)},
		[]*agentexecutionv1.SubAgentExecution{{
			Name:     "helper",
			Messages: []*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(subTC)},
		}},
	)

	found := findToolCallInExecution(exec, "call_shared_id")
	if found == nil {
		t.Fatal("expected to find tool call, got nil")
	}
	if found.GetName() != "root_tool" {
		t.Errorf("should return root match first: got Name=%q, want %q", found.GetName(), "root_tool")
	}
}

// ---------------------------------------------------------------------------
// Approval decision recording
// ---------------------------------------------------------------------------

// TestRecordApprovalDecisionOnToolCallInMessages verifies that the approval
// action is recorded on the ToolCall embedded in messages, not on a
// separate flat list. This is the contract that recordApprovalDecisionStep
// implements.
func TestRecordApprovalDecisionOnToolCallInMessages(t *testing.T) {
	tc := makeApprovalToolCall("call_abc123", "delete_file")
	exec := makeExecutionWithMessages(
		[]*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(tc)},
		nil,
	)

	action := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE
	now := time.Now().UTC().Format(time.RFC3339)

	found := findToolCallInExecution(exec, "call_abc123")
	if found == nil {
		t.Fatal("precondition: tool call must be findable")
	}
	found.ApprovalAction = action
	found.ApprovalDecidedAt = now

	// The ToolCall in messages is mutated in place — verify via the message.
	resultTC := exec.Status.Messages[0].ToolCalls[0]
	if resultTC.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE {
		t.Errorf("approval_action = %v, want APPROVE", resultTC.GetApprovalAction())
	}
	if resultTC.GetApprovalDecidedAt() == "" {
		t.Error("approval_decided_at must be set")
	}
}

// TestRecordApprovalDecisionRecomputesPendingApprovals verifies that after
// recording a decision, recomputing pending_approvals causes the decided
// entry to disappear (approval_action is no longer UNSPECIFIED).
func TestRecordApprovalDecisionRecomputesPendingApprovals(t *testing.T) {
	tc1 := makeApprovalToolCall("call_001", "delete_file")
	tc2 := makeApprovalToolCall("call_002", "write_file")
	exec := makeExecutionWithMessages(
		[]*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(tc1, tc2)},
		nil,
	)

	if len(exec.Status.PendingApprovals) != 2 {
		t.Fatalf("precondition: want 2 pending approvals, got %d", len(exec.Status.PendingApprovals))
	}

	// Simulate approving call_001.
	found := findToolCallInExecution(exec, "call_001")
	found.ApprovalAction = agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE
	found.ApprovalDecidedAt = time.Now().UTC().Format(time.RFC3339)

	// Recompute — mirrors what recordApprovalDecisionStep does.
	exec.Status.PendingApprovals = approval.ComputePendingApprovals(
		exec.Status.GetMessages(),
		exec.Status.GetSubAgentExecutions(),
	)

	if len(exec.Status.PendingApprovals) != 1 {
		t.Fatalf("after approving one, want 1 pending approval, got %d", len(exec.Status.PendingApprovals))
	}
	if exec.Status.PendingApprovals[0].GetToolCallId() != "call_002" {
		t.Errorf("remaining PA should be call_002, got %q", exec.Status.PendingApprovals[0].GetToolCallId())
	}
}

// TestApprovalDecisionTimestampIsSet verifies that approval_decided_at is
// populated with a valid RFC3339 timestamp when a decision is recorded.
func TestApprovalDecisionTimestampIsSet(t *testing.T) {
	tc := makeApprovalToolCall("call_abc123", "send_email")
	exec := makeExecutionWithMessages(
		[]*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(tc)},
		nil,
	)

	before := time.Now().UTC().Truncate(time.Second)

	found := findToolCallInExecution(exec, "call_abc123")
	found.ApprovalAction = agentexecutionv1.ApprovalAction_APPROVAL_ACTION_SKIP
	found.ApprovalDecidedAt = time.Now().UTC().Format(time.RFC3339)

	parsed, err := time.Parse(time.RFC3339, found.ApprovalDecidedAt)
	if err != nil {
		t.Fatalf("approval_decided_at is not valid RFC3339: %v", err)
	}
	if parsed.Before(before) {
		t.Errorf("approval_decided_at %v is before test start %v", parsed, before)
	}
}

// TestSubAgentApprovalDecisionRecordedOnCorrectToolCall verifies that when
// a sub-agent tool call is approved, the decision is recorded on the correct
// ToolCall inside the sub-agent's messages, not on a root-level structure.
func TestSubAgentApprovalDecisionRecordedOnCorrectToolCall(t *testing.T) {
	rootTC := makeApprovalToolCall("call_root", "deploy")
	subTC := makeApprovalToolCall("call_sub", "run_tests")

	exec := makeExecutionWithMessages(
		[]*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(rootTC)},
		[]*agentexecutionv1.SubAgentExecution{{
			Name:     "code-reviewer",
			Messages: []*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(subTC)},
		}},
	)

	if len(exec.Status.PendingApprovals) != 2 {
		t.Fatalf("precondition: want 2 pending approvals, got %d", len(exec.Status.PendingApprovals))
	}

	// Approve the sub-agent's tool call.
	found := findToolCallInExecution(exec, "call_sub")
	if found == nil {
		t.Fatal("sub-agent tool call must be findable")
	}
	found.ApprovalAction = agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE
	found.ApprovalDecidedAt = time.Now().UTC().Format(time.RFC3339)

	// Root tool call should be unaffected.
	rootFound := findToolCallInExecution(exec, "call_root")
	if rootFound.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED {
		t.Errorf("root tool call should not be affected: got action=%v", rootFound.GetApprovalAction())
	}

	// Recompute — only the root tool call should remain pending.
	exec.Status.PendingApprovals = approval.ComputePendingApprovals(
		exec.Status.GetMessages(),
		exec.Status.GetSubAgentExecutions(),
	)

	if len(exec.Status.PendingApprovals) != 1 {
		t.Fatalf("after sub-agent approval, want 1 pending approval, got %d", len(exec.Status.PendingApprovals))
	}
	remaining := exec.Status.PendingApprovals[0]
	if remaining.GetToolCallId() != "call_root" {
		t.Errorf("remaining PA should be call_root, got %q", remaining.GetToolCallId())
	}
	if remaining.GetFromSubAgent() {
		t.Error("remaining PA should not be from a sub-agent")
	}
}

// TestAllApprovalsResolvedClearsPendingApprovals verifies that approving all
// pending tool calls results in an empty pending_approvals list.
func TestAllApprovalsResolvedClearsPendingApprovals(t *testing.T) {
	tc := makeApprovalToolCall("call_only", "dangerous_op")
	exec := makeExecutionWithMessages(
		[]*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(tc)},
		nil,
	)

	found := findToolCallInExecution(exec, "call_only")
	found.ApprovalAction = agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT
	found.ApprovalDecidedAt = time.Now().UTC().Format(time.RFC3339)

	exec.Status.PendingApprovals = approval.ComputePendingApprovals(
		exec.Status.GetMessages(),
		exec.Status.GetSubAgentExecutions(),
	)

	if len(exec.Status.PendingApprovals) != 0 {
		t.Errorf("all approvals resolved: want 0 pending, got %d", len(exec.Status.PendingApprovals))
	}
}

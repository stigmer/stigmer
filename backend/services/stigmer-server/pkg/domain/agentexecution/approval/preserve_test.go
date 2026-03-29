package approval

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// makeApprovalToolCall builds a ToolCall with all approval-related fields
// populated, complementing the simpler makeToolCall in compute_test.go.
func makeApprovalToolCall(id string, action agentexecutionv1.ApprovalAction, decidedAt, approvedBy string) *agentexecutionv1.ToolCall {
	tc := makeToolCall(id, "tool_"+id,
		agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL,
		true, action)
	tc.ApprovalDecidedAt = decidedAt
	tc.ApprovedBy = approvedBy
	return tc
}

func TestPreserveApprovalFields_RootMessage(t *testing.T) {
	existing := []*agentexecutionv1.AgentMessage{
		makeAIMessage(makeApprovalToolCall("tc_1",
			agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
			"2026-03-29T10:05:00Z", "user@test.com")),
	}
	incoming := []*agentexecutionv1.AgentMessage{
		makeAIMessage(makeApprovalToolCall("tc_1",
			agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED, "", "")),
	}

	PreserveApprovalFields(incoming, nil, existing, nil)

	tc := incoming[0].ToolCalls[0]
	if tc.ApprovalAction != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE {
		t.Errorf("approval_action = %v, want APPROVE", tc.ApprovalAction)
	}
	if tc.ApprovalDecidedAt != "2026-03-29T10:05:00Z" {
		t.Errorf("approval_decided_at = %q, want %q", tc.ApprovalDecidedAt, "2026-03-29T10:05:00Z")
	}
	if tc.ApprovedBy != "user@test.com" {
		t.Errorf("approved_by = %q, want %q", tc.ApprovedBy, "user@test.com")
	}
}

func TestPreserveApprovalFields_SubAgentMessage(t *testing.T) {
	existingSubs := []*agentexecutionv1.SubAgentExecution{{
		Name: "reviewer",
		Messages: []*agentexecutionv1.AgentMessage{
			makeAIMessage(makeApprovalToolCall("tc_sub_1",
				agentexecutionv1.ApprovalAction_APPROVAL_ACTION_SKIP,
				"2026-03-29T10:10:00Z", "admin@test.com")),
		},
	}}
	incomingSubs := []*agentexecutionv1.SubAgentExecution{{
		Name: "reviewer",
		Messages: []*agentexecutionv1.AgentMessage{
			makeAIMessage(makeApprovalToolCall("tc_sub_1",
				agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED, "", "")),
		},
	}}

	PreserveApprovalFields(nil, incomingSubs, nil, existingSubs)

	tc := incomingSubs[0].Messages[0].ToolCalls[0]
	if tc.ApprovalAction != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_SKIP {
		t.Errorf("approval_action = %v, want SKIP", tc.ApprovalAction)
	}
	if tc.ApprovalDecidedAt != "2026-03-29T10:10:00Z" {
		t.Errorf("approval_decided_at = %q, want %q", tc.ApprovalDecidedAt, "2026-03-29T10:10:00Z")
	}
	if tc.ApprovedBy != "admin@test.com" {
		t.Errorf("approved_by = %q, want %q", tc.ApprovedBy, "admin@test.com")
	}
}

func TestPreserveApprovalFields_NoExistingApprovals(t *testing.T) {
	existing := []*agentexecutionv1.AgentMessage{
		makeAIMessage(makeApprovalToolCall("tc_1",
			agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED, "", "")),
	}
	incoming := []*agentexecutionv1.AgentMessage{
		makeAIMessage(makeApprovalToolCall("tc_1",
			agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED, "", "")),
	}

	PreserveApprovalFields(incoming, nil, existing, nil)

	tc := incoming[0].ToolCalls[0]
	if tc.ApprovalAction != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED {
		t.Errorf("approval_action = %v, want UNSPECIFIED (no existing approval to preserve)", tc.ApprovalAction)
	}
}

func TestPreserveApprovalFields_DoesNotOverwriteNonUnspecified(t *testing.T) {
	existing := []*agentexecutionv1.AgentMessage{
		makeAIMessage(makeApprovalToolCall("tc_1",
			agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
			"2026-03-29T10:05:00Z", "user@test.com")),
	}
	incoming := []*agentexecutionv1.AgentMessage{
		makeAIMessage(makeApprovalToolCall("tc_1",
			agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT,
			"2026-03-29T10:08:00Z", "other@test.com")),
	}

	PreserveApprovalFields(incoming, nil, existing, nil)

	tc := incoming[0].ToolCalls[0]
	if tc.ApprovalAction != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT {
		t.Errorf("should not overwrite non-UNSPECIFIED: approval_action = %v, want REJECT", tc.ApprovalAction)
	}
	if tc.ApprovedBy != "other@test.com" {
		t.Errorf("should not overwrite non-UNSPECIFIED: approved_by = %q, want %q", tc.ApprovedBy, "other@test.com")
	}
}

func TestPreserveApprovalFields_NewToolCallUnaffected(t *testing.T) {
	existing := []*agentexecutionv1.AgentMessage{
		makeAIMessage(makeApprovalToolCall("tc_1",
			agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
			"2026-03-29T10:05:00Z", "user@test.com")),
	}
	incoming := []*agentexecutionv1.AgentMessage{
		makeAIMessage(
			makeApprovalToolCall("tc_1",
				agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED, "", ""),
			makeApprovalToolCall("tc_new",
				agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED, "", ""),
		),
	}

	PreserveApprovalFields(incoming, nil, existing, nil)

	tcNew := incoming[0].ToolCalls[1]
	if tcNew.ApprovalAction != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED {
		t.Errorf("new tool call should be unaffected: approval_action = %v, want UNSPECIFIED", tcNew.ApprovalAction)
	}
	if tcNew.ApprovedBy != "" {
		t.Errorf("new tool call should be unaffected: approved_by = %q, want empty", tcNew.ApprovedBy)
	}
}

func TestPreserveApprovalFields_MixedApprovalStates(t *testing.T) {
	existing := []*agentexecutionv1.AgentMessage{
		makeAIMessage(
			makeApprovalToolCall("tc_approved",
				agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
				"2026-03-29T10:05:00Z", "user1@test.com"),
			makeApprovalToolCall("tc_pending",
				agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED, "", ""),
		),
	}
	existingSubs := []*agentexecutionv1.SubAgentExecution{{
		Name: "reviewer",
		Messages: []*agentexecutionv1.AgentMessage{
			makeAIMessage(makeApprovalToolCall("tc_sub_rejected",
				agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT,
				"2026-03-29T10:07:00Z", "user2@test.com")),
		},
	}}
	incoming := []*agentexecutionv1.AgentMessage{
		makeAIMessage(
			makeApprovalToolCall("tc_approved",
				agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED, "", ""),
			makeApprovalToolCall("tc_pending",
				agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED, "", ""),
		),
	}
	incomingSubs := []*agentexecutionv1.SubAgentExecution{{
		Name: "reviewer",
		Messages: []*agentexecutionv1.AgentMessage{
			makeAIMessage(makeApprovalToolCall("tc_sub_rejected",
				agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED, "", "")),
		},
	}}

	PreserveApprovalFields(incoming, incomingSubs, existing, existingSubs)

	tcApproved := incoming[0].ToolCalls[0]
	if tcApproved.ApprovalAction != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE {
		t.Errorf("tc_approved: approval_action = %v, want APPROVE", tcApproved.ApprovalAction)
	}
	if tcApproved.ApprovedBy != "user1@test.com" {
		t.Errorf("tc_approved: approved_by = %q, want %q", tcApproved.ApprovedBy, "user1@test.com")
	}

	tcPending := incoming[0].ToolCalls[1]
	if tcPending.ApprovalAction != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED {
		t.Errorf("tc_pending: approval_action = %v, want UNSPECIFIED", tcPending.ApprovalAction)
	}

	tcSubRejected := incomingSubs[0].Messages[0].ToolCalls[0]
	if tcSubRejected.ApprovalAction != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT {
		t.Errorf("tc_sub_rejected: approval_action = %v, want REJECT", tcSubRejected.ApprovalAction)
	}
	if tcSubRejected.ApprovedBy != "user2@test.com" {
		t.Errorf("tc_sub_rejected: approved_by = %q, want %q", tcSubRejected.ApprovedBy, "user2@test.com")
	}
}

func TestPreserveApprovalFields_CrossScopePreservation(t *testing.T) {
	existing := []*agentexecutionv1.AgentMessage{
		makeAIMessage(makeApprovalToolCall("tc_cross",
			agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
			"2026-03-29T10:05:00Z", "cross@test.com")),
	}
	incomingSubs := []*agentexecutionv1.SubAgentExecution{{
		Name: "helper",
		Messages: []*agentexecutionv1.AgentMessage{
			makeAIMessage(makeApprovalToolCall("tc_cross",
				agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED, "", "")),
		},
	}}

	PreserveApprovalFields(nil, incomingSubs, existing, nil)

	tc := incomingSubs[0].Messages[0].ToolCalls[0]
	if tc.ApprovalAction != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE {
		t.Errorf("cross-scope: approval_action = %v, want APPROVE", tc.ApprovalAction)
	}
}

func TestPreserveApprovalFields_NilSlices(t *testing.T) {
	PreserveApprovalFields(nil, nil, nil, nil)
}

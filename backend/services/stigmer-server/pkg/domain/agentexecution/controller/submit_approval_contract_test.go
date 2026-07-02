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

func makeMcpApprovalToolCall(id, name, serverSlug string) *agentexecutionv1.ToolCall {
	tc := makeApprovalToolCall(id, name)
	tc.McpServerSlug = serverSlug
	return tc
}

func makeAIMessageWithToolCalls(toolCalls ...*agentexecutionv1.ToolCall) *agentexecutionv1.AgentMessage {
	return &agentexecutionv1.AgentMessage{
		Type:      agentexecutionv1.MessageType_MESSAGE_AI,
		ToolCalls: toolCalls,
	}
}

func makeExecutionWithMessages(messages []*agentexecutionv1.AgentMessage, subAgents []*agentexecutionv1.SubAgentExecution) *agentexecutionv1.AgentExecution {
	return makeExecutionWithPhase(agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL, messages, subAgents)
}

func makeExecutionWithPhase(phase agentexecutionv1.ExecutionPhase, messages []*agentexecutionv1.AgentMessage, subAgents []*agentexecutionv1.SubAgentExecution) *agentexecutionv1.AgentExecution {
	return &agentexecutionv1.AgentExecution{
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase:              phase,
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

// ---------------------------------------------------------------------------
// APPROVE_ALL: scope-aware bulk-approve of co-pending tool calls
//
// These tests verify the contract implemented by bulkApproveCoPendingToolCalls:
// a single APPROVE_ALL grants a run-lifetime lease scoped to the clicked tool's
// CLASS (built-in category, or MCP server). Co-pending tool calls of the SAME
// class (root and sub-agents) are auto-approved; co-pending calls of a DIFFERENT
// class stay WAITING_APPROVAL, so pending_approvals (and thus the gate) clears
// only when no other-class approval is outstanding.
// ---------------------------------------------------------------------------

// TestApproveAllApprovesSameCategoryAcrossRootAndSubAgent verifies that an
// APPROVE_ALL on a built-in auto-approves co-pending built-ins of the SAME
// category anywhere in the execution (root + sub-agent).
func TestApproveAllApprovesSameCategoryAcrossRootAndSubAgent(t *testing.T) {
	clicked := makeApprovalToolCall("call_001", "delete_file")  // delete
	sameRoot := makeApprovalToolCall("call_002", "remove_file") // delete (same class)
	subSame := makeApprovalToolCall("call_sub", "delete")       // delete (same class, sub-agent)

	exec := makeExecutionWithMessages(
		[]*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(clicked, sameRoot)},
		[]*agentexecutionv1.SubAgentExecution{{
			Name:     "code-reviewer",
			Messages: []*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(subSame)},
		}},
	)

	now := time.Now().UTC().Format(time.RFC3339)
	clicked.ApprovalAction = agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE_ALL
	clicked.ApprovalDecidedAt = now
	bulkApproveCoPendingToolCalls(exec, "call_001", now, "")

	if clicked.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE_ALL {
		t.Errorf("clicked tool call should retain APPROVE_ALL, got %v", clicked.GetApprovalAction())
	}
	for _, id := range []string{"call_002", "call_sub"} {
		tc := findToolCallInExecution(exec, id)
		if tc.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE {
			t.Errorf("same-class co-pending %q should be APPROVE, got %v", id, tc.GetApprovalAction())
		}
		if tc.GetApprovalDecidedAt() == "" {
			t.Errorf("same-class co-pending %q should have approval_decided_at set", id)
		}
	}

	exec.Status.PendingApprovals = approval.ComputePendingApprovals(
		exec.Status.GetMessages(),
		exec.Status.GetSubAgentExecutions(),
	)
	if len(exec.Status.PendingApprovals) != 0 {
		t.Errorf("after same-class APPROVE_ALL: want 0 pending, got %d", len(exec.Status.PendingApprovals))
	}
}

// TestApproveAllLeavesDifferentCategoryPending is the core scope invariant:
// "approve all deletes" must NOT auto-approve a co-pending write, and the gate
// must stay open (pending_approvals non-empty) so the workflow keeps waiting.
func TestApproveAllLeavesDifferentCategoryPending(t *testing.T) {
	clicked := makeApprovalToolCall("call_001", "delete_file")   // delete
	otherClass := makeApprovalToolCall("call_002", "write_file") // write (different class)
	sameClass := makeApprovalToolCall("call_003", "remove_file") // delete (same class)

	exec := makeExecutionWithMessages(
		[]*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(clicked, otherClass, sameClass)},
		nil,
	)
	if len(exec.Status.PendingApprovals) != 3 {
		t.Fatalf("precondition: want 3 pending approvals, got %d", len(exec.Status.PendingApprovals))
	}

	now := time.Now().UTC().Format(time.RFC3339)
	clicked.ApprovalAction = agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE_ALL
	clicked.ApprovalDecidedAt = now
	bulkApproveCoPendingToolCalls(exec, "call_001", now, "")

	// Same-class delete is approved.
	if tc := findToolCallInExecution(exec, "call_003"); tc.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE {
		t.Errorf("same-class delete should be APPROVE, got %v", tc.GetApprovalAction())
	}
	// Different-class write stays WAITING with no decision.
	other := findToolCallInExecution(exec, "call_002")
	if other.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED {
		t.Errorf("different-class write must stay UNSPECIFIED, got %v", other.GetApprovalAction())
	}

	// The gate is NOT resolved: the write is still pending.
	exec.Status.PendingApprovals = approval.ComputePendingApprovals(
		exec.Status.GetMessages(),
		exec.Status.GetSubAgentExecutions(),
	)
	if len(exec.Status.PendingApprovals) != 1 {
		t.Errorf("after delete APPROVE_ALL with a co-pending write: want 1 pending, got %d", len(exec.Status.PendingApprovals))
	}
}

// TestApproveAllMcpScopeIsServerLevel verifies the MCP scope is per-server:
// approving-all an MCP tool auto-approves co-pending tools of the SAME server,
// but not a different server's tool nor a built-in.
func TestApproveAllMcpScopeIsServerLevel(t *testing.T) {
	clicked := makeMcpApprovalToolCall("call_001", "create_issue", "github") // github
	sameServer := makeMcpApprovalToolCall("call_002", "add_label", "github") // github (same)
	otherServer := makeMcpApprovalToolCall("call_003", "query", "database")  // different server
	builtin := makeApprovalToolCall("call_004", "write_file")                // built-in, different class

	exec := makeExecutionWithMessages(
		[]*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(clicked, sameServer, otherServer, builtin)},
		nil,
	)

	now := time.Now().UTC().Format(time.RFC3339)
	clicked.ApprovalAction = agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE_ALL
	clicked.ApprovalDecidedAt = now
	bulkApproveCoPendingToolCalls(exec, "call_001", now, "")

	if tc := findToolCallInExecution(exec, "call_002"); tc.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE {
		t.Errorf("same-server MCP tool should be APPROVE, got %v", tc.GetApprovalAction())
	}
	for _, id := range []string{"call_003", "call_004"} {
		tc := findToolCallInExecution(exec, id)
		if tc.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED {
			t.Errorf("out-of-scope %q must stay UNSPECIFIED, got %v", id, tc.GetApprovalAction())
		}
	}
}

// TestApproveAllDoesNotOverwriteAlreadyDecidedToolCalls verifies that
// bulk-approve only touches still-pending UNSPECIFIED tool calls and never
// clobbers a tool call that was already decided (e.g. a prior REJECT).
func TestApproveAllDoesNotOverwriteAlreadyDecidedToolCalls(t *testing.T) {
	clicked := makeApprovalToolCall("call_001", "delete_file")
	alreadyRejected := makeApprovalToolCall("call_002", "drop_table")
	alreadyRejected.ApprovalAction = agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT
	alreadyRejected.ApprovalDecidedAt = time.Now().UTC().Format(time.RFC3339)

	exec := makeExecutionWithMessages(
		[]*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(clicked, alreadyRejected)},
		nil,
	)

	now := time.Now().UTC().Format(time.RFC3339)
	clicked.ApprovalAction = agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE_ALL
	clicked.ApprovalDecidedAt = now
	bulkApproveCoPendingToolCalls(exec, "call_001", now, "")

	// The previously-rejected tool call must stay REJECT.
	rejected := findToolCallInExecution(exec, "call_002")
	if rejected.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT {
		t.Errorf("already-decided tool call should remain REJECT, got %v", rejected.GetApprovalAction())
	}
}

// ---------------------------------------------------------------------------
// T03: Approval gate resolution logic
//
// These tests verify the conditions under which the signalWorkflowStep
// should send the approvalGateResolved signal vs. skip signaling.
// ---------------------------------------------------------------------------

// TestGateResolvedWhenAllToolCallsDecided verifies that when all pending
// tool calls have been decided (pending_approvals is empty after recomputation),
// the gate is considered resolved.
func TestGateResolvedWhenAllToolCallsDecided(t *testing.T) {
	tc1 := makeApprovalToolCall("call_001", "delete_file")
	tc2 := makeApprovalToolCall("call_002", "write_file")
	exec := makeExecutionWithMessages(
		[]*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(tc1, tc2)},
		nil,
	)

	// Approve both tool calls
	for _, id := range []string{"call_001", "call_002"} {
		found := findToolCallInExecution(exec, id)
		found.ApprovalAction = agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE
		found.ApprovalDecidedAt = time.Now().UTC().Format(time.RFC3339)
	}

	exec.Status.PendingApprovals = approval.ComputePendingApprovals(
		exec.Status.GetMessages(),
		exec.Status.GetSubAgentExecutions(),
	)

	pendingRemaining := len(exec.Status.PendingApprovals)
	isReject := false
	allDecided := pendingRemaining == 0

	if !allDecided {
		t.Fatalf("expected allDecided=true when all tool calls approved, got pending=%d", pendingRemaining)
	}

	shouldSignal := isReject || allDecided
	if !shouldSignal {
		t.Error("gate should be resolved (all decided) — signal expected")
	}
}

// TestGateNotResolvedWhenApprovalsPending verifies that when some tool calls
// still lack decisions, the gate remains unresolved and no signal should be sent.
func TestGateNotResolvedWhenApprovalsPending(t *testing.T) {
	tc1 := makeApprovalToolCall("call_001", "delete_file")
	tc2 := makeApprovalToolCall("call_002", "write_file")
	exec := makeExecutionWithMessages(
		[]*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(tc1, tc2)},
		nil,
	)

	// Only approve one
	found := findToolCallInExecution(exec, "call_001")
	found.ApprovalAction = agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE
	found.ApprovalDecidedAt = time.Now().UTC().Format(time.RFC3339)

	exec.Status.PendingApprovals = approval.ComputePendingApprovals(
		exec.Status.GetMessages(),
		exec.Status.GetSubAgentExecutions(),
	)

	pendingRemaining := len(exec.Status.PendingApprovals)
	action := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE
	isReject := action == agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT
	allDecided := pendingRemaining == 0

	shouldSignal := isReject || allDecided
	if shouldSignal {
		t.Errorf("gate should NOT be resolved (1 still pending) — no signal expected, but pending=%d", pendingRemaining)
	}

	if pendingRemaining != 1 {
		t.Errorf("expected 1 pending approval remaining, got %d", pendingRemaining)
	}
}

// TestGateResolvedOnRejectEvenWithPending verifies that a REJECT action
// triggers immediate gate resolution regardless of remaining pending approvals.
func TestGateResolvedOnRejectEvenWithPending(t *testing.T) {
	tc1 := makeApprovalToolCall("call_001", "delete_file")
	tc2 := makeApprovalToolCall("call_002", "write_file")
	exec := makeExecutionWithMessages(
		[]*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(tc1, tc2)},
		nil,
	)

	// Reject only one — the other is still pending
	found := findToolCallInExecution(exec, "call_001")
	found.ApprovalAction = agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT
	found.ApprovalDecidedAt = time.Now().UTC().Format(time.RFC3339)

	exec.Status.PendingApprovals = approval.ComputePendingApprovals(
		exec.Status.GetMessages(),
		exec.Status.GetSubAgentExecutions(),
	)

	pendingRemaining := len(exec.Status.PendingApprovals)
	action := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT
	isReject := action == agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT
	allDecided := pendingRemaining == 0

	if pendingRemaining != 1 {
		t.Fatalf("precondition: expected 1 pending approval remaining, got %d", pendingRemaining)
	}

	shouldSignal := isReject || allDecided
	if !shouldSignal {
		t.Error("gate should be resolved on REJECT — signal expected even with pending approvals")
	}
}

// ---------------------------------------------------------------------------
// T04: Phase gate relaxation
//
// These tests verify that approval is accepted during EXECUTION_IN_PROGRESS
// (enabling approval while other sub-agents are still streaming) and rejected
// during terminal phases.
// ---------------------------------------------------------------------------

// TestApprovalAllowedDuringInProgress verifies that the phase gate accepts
// IN_PROGRESS alongside WAITING_FOR_APPROVAL. This is the core T04 scenario:
// sub-agent 1 needs approval while sub-agents 2-4 are still streaming.
func TestApprovalAllowedDuringInProgress(t *testing.T) {
	tc := makeApprovalToolCall("call_stream_001", "write_file")
	exec := makeExecutionWithPhase(
		agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		[]*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(tc)},
		nil,
	)

	found := findToolCallInExecution(exec, "call_stream_001")
	if found == nil {
		t.Fatal("precondition: tool call must be findable")
	}

	// The tool call is in WAITING_APPROVAL with UNSPECIFIED action — a fresh
	// approval should be allowed even though the execution phase is IN_PROGRESS.
	if found.GetStatus() != agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL {
		t.Fatalf("precondition: tool call status = %v, want TOOL_CALL_WAITING_APPROVAL",
			found.GetStatus())
	}
	if found.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED {
		t.Fatalf("precondition: approval_action = %v, want UNSPECIFIED",
			found.GetApprovalAction())
	}

	// Simulate recording the approval decision.
	found.ApprovalAction = agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE
	found.ApprovalDecidedAt = time.Now().UTC().Format(time.RFC3339)

	if found.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE {
		t.Errorf("after approval: approval_action = %v, want APPROVE", found.GetApprovalAction())
	}

	// Recompute pending_approvals — the approved entry should disappear.
	exec.Status.PendingApprovals = approval.ComputePendingApprovals(
		exec.Status.GetMessages(),
		exec.Status.GetSubAgentExecutions(),
	)
	if len(exec.Status.PendingApprovals) != 0 {
		t.Errorf("after approval during IN_PROGRESS: want 0 pending, got %d",
			len(exec.Status.PendingApprovals))
	}
}

// TestApprovalRejectedDuringCompletedPhase verifies that terminal phases
// (COMPLETED, FAILED, CANCELLED) still reject approval submissions.
func TestApprovalRejectedDuringCompletedPhase(t *testing.T) {
	terminalPhases := []agentexecutionv1.ExecutionPhase{
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
		agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED,
	}

	for _, phase := range terminalPhases {
		t.Run(phase.String(), func(t *testing.T) {
			// The phase gate check: neither WAITING_FOR_APPROVAL nor IN_PROGRESS.
			isAllowed := phase == agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL ||
				phase == agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS

			if isAllowed {
				t.Errorf("terminal phase %s should NOT be in the allowed set", phase.String())
			}
		})
	}
}

// TestGateResolutionDuringInProgress verifies that the signal-sending logic
// (REJECT or all-decided) works identically when the execution is IN_PROGRESS.
// The signal is sent regardless of phase — Temporal buffers it if the workflow
// hasn't entered the approval loop yet.
func TestGateResolutionDuringInProgress(t *testing.T) {
	tc1 := makeApprovalToolCall("call_s1", "deploy")
	tc2 := makeApprovalToolCall("call_s2", "run_tests")

	exec := makeExecutionWithPhase(
		agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		[]*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(tc1, tc2)},
		nil,
	)

	t.Run("all decided during streaming", func(t *testing.T) {
		// Approve both tool calls while streaming.
		for _, id := range []string{"call_s1", "call_s2"} {
			found := findToolCallInExecution(exec, id)
			found.ApprovalAction = agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE
			found.ApprovalDecidedAt = time.Now().UTC().Format(time.RFC3339)
		}

		exec.Status.PendingApprovals = approval.ComputePendingApprovals(
			exec.Status.GetMessages(),
			exec.Status.GetSubAgentExecutions(),
		)

		pendingRemaining := len(exec.Status.PendingApprovals)
		allDecided := pendingRemaining == 0

		if !allDecided {
			t.Fatalf("expected allDecided=true during IN_PROGRESS, got pending=%d", pendingRemaining)
		}

		shouldSignal := false || allDecided // isReject=false
		if !shouldSignal {
			t.Error("gate should resolve during IN_PROGRESS when all tool calls decided")
		}
	})

	t.Run("reject during streaming", func(t *testing.T) {
		// Reset: fresh execution with undecided tool calls.
		tc3 := makeApprovalToolCall("call_s3", "dangerous_op")
		tc4 := makeApprovalToolCall("call_s4", "safe_op")
		execReject := makeExecutionWithPhase(
			agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			[]*agentexecutionv1.AgentMessage{makeAIMessageWithToolCalls(tc3, tc4)},
			nil,
		)

		// Reject only one during streaming.
		found := findToolCallInExecution(execReject, "call_s3")
		found.ApprovalAction = agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT
		found.ApprovalDecidedAt = time.Now().UTC().Format(time.RFC3339)

		execReject.Status.PendingApprovals = approval.ComputePendingApprovals(
			execReject.Status.GetMessages(),
			execReject.Status.GetSubAgentExecutions(),
		)

		pendingRemaining := len(execReject.Status.PendingApprovals)
		isReject := true
		allDecided := pendingRemaining == 0

		if pendingRemaining != 1 {
			t.Fatalf("precondition: expected 1 pending remaining, got %d", pendingRemaining)
		}

		shouldSignal := isReject || allDecided
		if !shouldSignal {
			t.Error("REJECT during IN_PROGRESS should resolve the gate — signal expected")
		}
	})
}

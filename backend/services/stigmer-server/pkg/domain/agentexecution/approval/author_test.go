package approval

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

func statusWith(messages []*agentexecutionv1.AgentMessage, subAgents []*agentexecutionv1.SubAgentExecution) *agentexecutionv1.AgentExecutionStatus {
	return &agentexecutionv1.AgentExecutionStatus{
		Messages:           messages,
		SubAgentExecutions: subAgents,
	}
}

func countEvents(stream *agentexecutionv1.ApprovalEventStream, eventType agentexecutionv1.ApprovalEventType) int {
	n := 0
	for _, ev := range stream.GetEvents() {
		if ev.GetEventType() == eventType {
			n++
		}
	}
	return n
}

// TestEnsureApprovalRequestsSeedsWhenEmpty proves the seed-if-empty path: an
// execution whose stream is empty is populated from the authoritative scan with
// exactly one REQUESTED per gated tool call and no decision events (nothing has
// been decided yet), and the execution id is stamped onto the stream.
func TestEnsureApprovalRequestsSeedsWhenEmpty(t *testing.T) {
	waiting := agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL
	unspecified := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED

	status := statusWith([]*agentexecutionv1.AgentMessage{
		makeAIMessage(
			makeToolCall("tc1", "delete_file", waiting, true, unspecified),
			makeToolCall("tc2", "shell", waiting, true, unspecified),
		),
	}, nil)

	EnsureApprovalRequests(status, "exec-1")

	stream := status.GetApprovalEventStream()
	if stream == nil {
		t.Fatal("expected stream to be seeded, got nil")
	}
	if stream.GetExecutionId() != "exec-1" {
		t.Errorf("execution_id = %q, want %q", stream.GetExecutionId(), "exec-1")
	}
	if got := countEvents(stream, agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_REQUESTED); got != 2 {
		t.Errorf("REQUESTED count = %d, want 2", got)
	}
	if got := len(stream.GetEvents()); got != 2 {
		t.Errorf("total events = %d, want 2 (no decisions yet)", got)
	}
}

// TestEnsureApprovalRequestsAppendsRequestedOnce proves idempotency: calling
// EnsureApprovalRequests repeatedly, and on an already-seeded stream, never
// duplicates a REQUESTED event (append-if-absent by event_id), and appends a
// REQUESTED for a newly-gated tool call.
func TestEnsureApprovalRequestsAppendsRequestedOnce(t *testing.T) {
	waiting := agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL
	unspecified := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED

	status := statusWith([]*agentexecutionv1.AgentMessage{
		makeAIMessage(makeToolCall("tc1", "delete_file", waiting, true, unspecified)),
	}, nil)

	EnsureApprovalRequests(status, "exec-1")
	EnsureApprovalRequests(status, "exec-1") // repeat: must not duplicate

	if got := len(status.GetApprovalEventStream().GetEvents()); got != 1 {
		t.Fatalf("after repeated ensure, events = %d, want 1", got)
	}

	// A second tool call enters the gate later.
	status.Messages = append(status.Messages,
		makeAIMessage(makeToolCall("tc2", "shell", waiting, true, unspecified)))
	EnsureApprovalRequests(status, "exec-1")

	if got := countEvents(status.GetApprovalEventStream(), agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_REQUESTED); got != 2 {
		t.Errorf("REQUESTED count = %d, want 2 after a new gated call appeared", got)
	}
}

// TestRecordDecisionEventCapturesAudit proves the rich-decision path: the
// authored decision event carries decided_by and the user's comment that the
// flat ToolCall fields cannot hold, and preserves the precise action.
func TestRecordDecisionEventCapturesAudit(t *testing.T) {
	waiting := agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL
	approveAll := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE_ALL

	status := statusWith([]*agentexecutionv1.AgentMessage{
		makeAIMessage(makeToolCall("tc1", "shell", waiting, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED)),
	}, nil)
	EnsureApprovalRequests(status, "exec-1")

	tc := status.GetMessages()[0].GetToolCalls()[0]
	tc.ApprovalAction = approveAll
	tc.ApprovalDecidedAt = "2026-03-27T10:05:00Z"

	RecordDecisionEvent(status, tc, "alice@example.com", "looks safe, approving for the run")

	decided := findDecisionEvent(t, status.GetApprovalEventStream(), "tc1")
	if decided.GetDecided().GetDecidedBy() != "alice@example.com" {
		t.Errorf("decided_by = %q, want alice@example.com", decided.GetDecided().GetDecidedBy())
	}
	if decided.GetDecided().GetComment() != "looks safe, approving for the run" {
		t.Errorf("comment = %q, want the escalation comment", decided.GetDecided().GetComment())
	}
	if decided.GetDecided().GetAction() != approveAll {
		t.Errorf("action = %v, want APPROVE_ALL preserved", decided.GetDecided().GetAction())
	}
	if decided.GetEventType() != agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_APPROVED {
		t.Errorf("event_type = %v, want APPROVED bucket", decided.GetEventType())
	}
}

// TestRecordDecisionEventAppendIfAbsent proves a repeated decision (idempotent
// re-submit) does not double-record, and a no-action tool call is a no-op.
func TestRecordDecisionEventAppendIfAbsent(t *testing.T) {
	waiting := agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL
	approve := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE

	status := statusWith([]*agentexecutionv1.AgentMessage{
		makeAIMessage(makeToolCall("tc1", "delete_file", waiting, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED)),
	}, nil)
	EnsureApprovalRequests(status, "exec-1")

	tc := status.GetMessages()[0].GetToolCalls()[0]
	tc.ApprovalAction = approve
	tc.ApprovalDecidedAt = "2026-03-27T10:05:00Z"

	RecordDecisionEvent(status, tc, "bob", "ok")
	RecordDecisionEvent(status, tc, "bob", "ok") // repeat

	if got := countEvents(status.GetApprovalEventStream(), agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_APPROVED); got != 1 {
		t.Errorf("APPROVED count = %d, want 1 after a repeated submit", got)
	}

	// No-action tool call: no decision event authored.
	undecided := makeToolCall("tc2", "shell", waiting, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED)
	before := len(status.GetApprovalEventStream().GetEvents())
	RecordDecisionEvent(status, undecided, "bob", "")
	if after := len(status.GetApprovalEventStream().GetEvents()); after != before {
		t.Errorf("recording a no-action tool call changed event count: before=%d after=%d", before, after)
	}
}

// TestAuthoredStreamProjectsToScan is the end-to-end author→project parity: after
// seeding REQUESTED and recording a rich decision, projecting the persisted stream
// yields the same pending set as the message scan.
func TestAuthoredStreamProjectsToScan(t *testing.T) {
	waiting := agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL
	unspecified := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED
	approve := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE

	status := statusWith([]*agentexecutionv1.AgentMessage{
		makeAIMessage(
			makeToolCall("tc1", "delete_file", waiting, true, unspecified),
			makeToolCall("tc2", "shell", waiting, true, unspecified),
		),
	}, nil)
	EnsureApprovalRequests(status, "exec-1")

	// Decide tc1; tc2 stays pending.
	tc1 := status.GetMessages()[0].GetToolCalls()[0]
	tc1.ApprovalAction = approve
	tc1.ApprovalDecidedAt = "2026-03-27T10:05:00Z"
	RecordDecisionEvent(status, tc1, "alice", "approved")

	fromScan := ComputePendingApprovals(status.GetMessages(), status.GetSubAgentExecutions())
	fromEvents := ComputePendingApprovalsFromEvents(status.GetApprovalEventStream())
	if diff := diffPendingApprovals(fromScan, fromEvents); diff != "" {
		t.Errorf("authored stream projection diverged from scan: %s", diff)
	}
}

func findDecisionEvent(t *testing.T, stream *agentexecutionv1.ApprovalEventStream, requestID string) *agentexecutionv1.ApprovalEvent {
	t.Helper()
	for _, ev := range stream.GetEvents() {
		if ev.GetApprovalRequestId() == requestID && ev.GetDecided() != nil {
			return ev
		}
	}
	t.Fatalf("no decision event found for request %q", requestID)
	return nil
}

package approval

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

func subAgent(name, subject string, status agentexecutionv1.SubAgentStatus, toolCalls ...*agentexecutionv1.ToolCall) *agentexecutionv1.SubAgentExecution {
	return &agentexecutionv1.SubAgentExecution{
		Name:     name,
		Subject:  subject,
		Status:   status,
		Messages: []*agentexecutionv1.AgentMessage{makeAIMessage(toolCalls...)},
	}
}

// TestEventStreamProjectionMatchesMessageScan is the core Phase-1 parity proof:
// for the same authoritative inputs, the event-stream projection must produce
// the identical pending-approval set as the message scan. If these ever diverge,
// the shadow source is unsafe to promote.
func TestEventStreamProjectionMatchesMessageScan(t *testing.T) {
	approveAll := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE_ALL
	approve := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE
	unspecified := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED
	waiting := agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL
	running := agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING

	tests := []struct {
		name      string
		messages  []*agentexecutionv1.AgentMessage
		subAgents []*agentexecutionv1.SubAgentExecution
	}{
		{name: "empty"},
		{
			name: "single pending root",
			messages: []*agentexecutionv1.AgentMessage{
				makeAIMessage(makeToolCall("tc1", "delete_file", waiting, true, unspecified)),
			},
		},
		{
			name: "decided root excluded",
			messages: []*agentexecutionv1.AgentMessage{
				makeAIMessage(makeToolCall("tc1", "delete_file", waiting, true, approve)),
			},
		},
		{
			name: "approve-all decided excluded",
			messages: []*agentexecutionv1.AgentMessage{
				makeAIMessage(makeToolCall("tc1", "shell", waiting, true, approveAll)),
			},
		},
		{
			name: "non-waiting not emitted",
			messages: []*agentexecutionv1.AgentMessage{
				makeAIMessage(makeToolCall("tc1", "read_file", running, true, unspecified)),
			},
		},
		{
			name: "mixed root and active sub-agent",
			messages: []*agentexecutionv1.AgentMessage{
				makeAIMessage(makeToolCall("tc-root", "deploy", waiting, true, unspecified)),
			},
			subAgents: []*agentexecutionv1.SubAgentExecution{
				subAgent("code-reviewer", "Review the diff", agentexecutionv1.SubAgentStatus_SUB_AGENT_IN_PROGRESS,
					makeToolCall("tc-sub", "run_tests", waiting, true, unspecified)),
			},
		},
		{
			name: "terminal sub-agent excluded",
			subAgents: []*agentexecutionv1.SubAgentExecution{
				subAgent("done", "finished", agentexecutionv1.SubAgentStatus_SUB_AGENT_COMPLETED,
					makeToolCall("tc-orphan", "write_file", waiting, true, unspecified)),
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fromScan := ComputePendingApprovals(tt.messages, tt.subAgents)
			stream := EmitApprovalEvents(tt.messages, tt.subAgents)
			fromEvents := ComputePendingApprovalsFromEvents(stream)

			if diff := diffPendingApprovals(fromScan, fromEvents); diff != "" {
				t.Errorf("event-stream projection diverged from message scan: %s\n scan=%d events=%d",
					diff, len(fromScan), len(fromEvents))
			}
		})
	}
}

// TestProjectPendingApprovalsReturnsMessageScan locks the seam contract: the
// authoritative return value is always the message scan, never the shadow.
func TestProjectPendingApprovalsReturnsMessageScan(t *testing.T) {
	msgs := []*agentexecutionv1.AgentMessage{
		makeAIMessage(
			makeToolCall("tc1", "delete_file", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED),
		),
	}
	want := ComputePendingApprovals(msgs, nil)
	got := ProjectPendingApprovals(msgs, nil, EmitApprovalEvents(msgs, nil))

	if diff := diffPendingApprovals(want, got); diff != "" {
		t.Errorf("seam result differs from message scan: %s", diff)
	}
}

// TestParityGuardDetectsMissingDecisionEvent proves the projection parity check
// is a real cross-writer guard now that it reads the persisted stream: if the
// scan records a decision but the stream is missing the matching DECIDED event
// (the failure mode where SubmitApproval recorded on the scan but failed to
// author the event), the scan and event projections diverge. This is the
// regression the tautological shadow-derivation could never catch.
func TestParityGuardDetectsMissingDecisionEvent(t *testing.T) {
	waiting := agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL
	approve := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE

	// Scan: tc1 is decided (APPROVE) → not pending.
	msgs := []*agentexecutionv1.AgentMessage{
		makeAIMessage(makeToolCall("tc1", "delete_file", waiting, true, approve)),
	}
	fromScan := ComputePendingApprovals(msgs, nil)

	// Stream as authored by a buggy writer: REQUESTED present, DECIDED missing →
	// the event projection still sees tc1 as pending.
	streamMissingDecision := &agentexecutionv1.ApprovalEventStream{
		Events: []*agentexecutionv1.ApprovalEvent{
			buildRequestedEvent(makeToolCall("tc1", "delete_file", waiting, true, approve), false, "", ""),
		},
	}
	fromEvents := ComputePendingApprovalsFromEvents(streamMissingDecision)

	if diff := diffPendingApprovals(fromScan, fromEvents); diff == "" {
		t.Error("expected the parity guard to detect a missing DECISION event, got no divergence")
	}
}

// TestEmitProducesRequestAndDecisionEvents verifies a decided tool call yields
// both a REQUESTED and a matching decision event, and that the decision payload
// preserves the precise action (APPROVE_ALL is not flattened to APPROVE).
func TestEmitProducesRequestAndDecisionEvents(t *testing.T) {
	tc := makeToolCall("tc1", "shell", agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL, true, agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE_ALL)
	tc.ApprovalDecidedAt = "2026-03-27T10:05:00Z"

	stream := EmitApprovalEvents([]*agentexecutionv1.AgentMessage{makeAIMessage(tc)}, nil)
	if len(stream.GetEvents()) != 2 {
		t.Fatalf("got %d events, want 2 (requested + decided)", len(stream.GetEvents()))
	}

	req := stream.GetEvents()[0]
	if req.GetEventType() != agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_REQUESTED {
		t.Errorf("event[0] type = %v, want REQUESTED", req.GetEventType())
	}
	if req.GetRequested().GetApprovalRequestId() != "tc1" {
		t.Errorf("approval_request_id = %q, want %q (== tool_call_id in Phase 1)", req.GetRequested().GetApprovalRequestId(), "tc1")
	}

	dec := stream.GetEvents()[1]
	if dec.GetEventType() != agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_APPROVED {
		t.Errorf("event[1] type = %v, want APPROVED bucket for APPROVE_ALL", dec.GetEventType())
	}
	if dec.GetDecided().GetAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE_ALL {
		t.Errorf("decision action = %v, want APPROVE_ALL preserved on payload", dec.GetDecided().GetAction())
	}
}

// TestDiffPendingApprovalsDetectsDivergence proves the divergence detector
// actually catches a mismatch (so the production warning is not a no-op).
func TestDiffPendingApprovalsDetectsDivergence(t *testing.T) {
	a := []*agentexecutionv1.PendingApproval{{ToolCallId: "tc1", ToolName: "delete_file"}}
	b := []*agentexecutionv1.PendingApproval{{ToolCallId: "tc1", ToolName: "send_email"}}

	if diff := diffPendingApprovals(a, b); diff == "" {
		t.Error("expected divergence to be detected for field mismatch, got none")
	}
	if diff := diffPendingApprovals(a, nil); diff == "" {
		t.Error("expected divergence to be detected for only-in-scan entry, got none")
	}
	if diff := diffPendingApprovals(a, a); diff != "" {
		t.Errorf("identical sets must not diverge, got %q", diff)
	}
}

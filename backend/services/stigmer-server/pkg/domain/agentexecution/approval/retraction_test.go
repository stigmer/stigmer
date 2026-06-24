package approval

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// This suite locks the property the whole "harden the stream" work exists to
// guarantee: after the reconciler runs at any write site, the event-stream
// projection equals the message-scan projection (the equality-at-every-write-site
// invariant). If it holds, flipping the seam's read source from scan to events is
// a provable behavioral no-op — including for the Temporal
// WAITING ⟺ ≥1 pending fail-fast. The Java mirror is RetractionReconcileTest.

// retractionFor returns the RETRACTED event for a request id, or nil.
func retractionFor(stream *agentexecutionv1.ApprovalEventStream, requestID string) *agentexecutionv1.ApprovalEvent {
	for _, ev := range stream.GetEvents() {
		if ev.GetApprovalRequestId() == requestID &&
			ev.GetEventType() == agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_RETRACTED {
			return ev
		}
	}
	return nil
}

// assertEqualityAtWriteSite is the invariant the flip rides on. For a live
// execution the two projections must be identical; for a terminal execution the
// phase-aware seam collapses both to empty (the parity-bug fix), which we assert
// directly.
func assertEqualityAtWriteSite(t *testing.T, status *agentexecutionv1.AgentExecutionStatus) {
	t.Helper()
	phase := status.GetPhase()
	scan := ComputePendingApprovals(status.GetMessages(), status.GetSubAgentExecutions())
	events := ComputePendingApprovalsFromEvents(status.GetApprovalEventStream())

	if isTerminalExecution(phase) {
		got := ProjectPendingApprovals(phase, status.GetMessages(), status.GetSubAgentExecutions(), status.GetApprovalEventStream())
		if len(got) != 0 {
			t.Fatalf("terminal execution (%s) must project zero pending, got %d", phase, len(got))
		}
		return
	}
	if diff := diffPendingApprovals(scan, events); diff != "" {
		t.Fatalf("equality-at-write-site violated (phase %s): %s", phase, diff)
	}
}

// TestRetractsInFlightSubAgentOrphan is the test that fails without the
// reconciler: a gated call inside a sub-agent that goes terminal undecided, while
// the execution is still live, must be RETRACTED so the event projection drops it
// exactly as the scan's terminal-sub-agent exclusion does.
func TestRetractsInFlightSubAgentOrphan(t *testing.T) {
	waiting := agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL
	unspecified := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED

	// A root gated call keeps the execution live; a sub-agent holds the orphan.
	status := statusWith(
		[]*agentexecutionv1.AgentMessage{makeAIMessage(makeToolCall("tc-root", "shell", waiting, true, unspecified))},
		[]*agentexecutionv1.SubAgentExecution{{
			Name:    "researcher",
			Subject: "Gather context",
			Status:  agentexecutionv1.SubAgentStatus_SUB_AGENT_IN_PROGRESS,
			Messages: []*agentexecutionv1.AgentMessage{
				makeAIMessage(makeToolCall("tc-orphan", "write_file", waiting, true, unspecified)),
			},
		}},
	)
	status.Phase = agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL

	EnsureApprovalRequests(status, "exec-1")
	assertEqualityAtWriteSite(t, status) // both pending, no retraction yet
	if retractionFor(status.GetApprovalEventStream(), "tc-orphan") != nil {
		t.Fatal("retracted a still-gated sub-agent call")
	}

	// The sub-agent finishes without the user deciding tc-orphan.
	status.SubAgentExecutions[0].Status = agentexecutionv1.SubAgentStatus_SUB_AGENT_FAILED
	EnsureApprovalRequests(status, "exec-1")

	ret := retractionFor(status.GetApprovalEventStream(), "tc-orphan")
	if ret == nil {
		t.Fatal("expected RETRACTED for the orphaned sub-agent call")
	}
	if got := ret.GetRetracted().GetReason(); got != agentexecutionv1.ApprovalRetractionReason_APPROVAL_RETRACTION_REASON_SUB_AGENT_TERMINAL {
		t.Errorf("reason = %v, want SUB_AGENT_TERMINAL", got)
	}
	if ret.GetActor() != actorSystem {
		t.Errorf("actor = %q, want system", ret.GetActor())
	}
	assertEqualityAtWriteSite(t, status) // now only tc-root is pending in both
}

// TestRetractsSupersededRootCall covers the other in-flight exit: a gated root
// call whose status advances off WAITING_APPROVAL with no decision (the harness
// superseded it on resume) is retracted with reason SUPERSEDED.
func TestRetractsSupersededRootCall(t *testing.T) {
	waiting := agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL
	unspecified := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED

	status := statusWith([]*agentexecutionv1.AgentMessage{
		makeAIMessage(
			makeToolCall("tc1", "delete_file", waiting, true, unspecified),
			makeToolCall("tc2", "shell", waiting, true, unspecified),
		),
	}, nil)
	status.Phase = agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL
	EnsureApprovalRequests(status, "exec-1")

	// tc1 is superseded: its status advances with no approval_action recorded.
	status.Messages[0].ToolCalls[0].Status = agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED
	EnsureApprovalRequests(status, "exec-1")

	ret := retractionFor(status.GetApprovalEventStream(), "tc1")
	if ret == nil {
		t.Fatal("expected RETRACTED for the superseded root call")
	}
	if got := ret.GetRetracted().GetReason(); got != agentexecutionv1.ApprovalRetractionReason_APPROVAL_RETRACTION_REASON_SUPERSEDED {
		t.Errorf("reason = %v, want SUPERSEDED", got)
	}
	assertEqualityAtWriteSite(t, status)
}

// TestRetractionIsIdempotent proves a re-run never appends a second RETRACTED for
// the same request (append-if-absent by event_id).
func TestRetractionIsIdempotent(t *testing.T) {
	waiting := agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL
	unspecified := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED

	status := statusWith([]*agentexecutionv1.AgentMessage{
		makeAIMessage(
			makeToolCall("tc1", "delete_file", waiting, true, unspecified),
			makeToolCall("tc-keep", "shell", waiting, true, unspecified),
		),
	}, nil)
	status.Phase = agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL
	EnsureApprovalRequests(status, "exec-1")

	status.Messages[0].ToolCalls[0].Status = agentexecutionv1.ToolCallStatus_TOOL_CALL_FAILED
	EnsureApprovalRequests(status, "exec-1")
	EnsureApprovalRequests(status, "exec-1") // repeat: must not duplicate

	if got := countEvents(status.GetApprovalEventStream(), agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_RETRACTED); got != 1 {
		t.Errorf("RETRACTED count = %d, want 1 after repeated reconcile", got)
	}
}

// TestNoFalseRetractionWhileGated is the critical negative: over-eager retraction
// would crash a parked execution to FAILED via the WAITING ⟺ ≥1 pending invariant.
// While the clicked + co-pending calls are still WAITING (the SubmitApproval
// pre-decision ensure), nothing is retracted.
func TestNoFalseRetractionWhileGated(t *testing.T) {
	waiting := agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL
	unspecified := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED

	status := statusWith([]*agentexecutionv1.AgentMessage{
		makeAIMessage(
			makeToolCall("tc1", "delete_file", waiting, true, unspecified),
			makeToolCall("tc2", "shell", waiting, true, unspecified),
		),
	}, nil)
	status.Phase = agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL

	EnsureApprovalRequests(status, "exec-1")
	EnsureApprovalRequests(status, "exec-1") // pre-decision ensure, run twice

	if got := countEvents(status.GetApprovalEventStream(), agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_RETRACTED); got != 0 {
		t.Errorf("RETRACTED count = %d, want 0 while every call is still gated", got)
	}
	assertEqualityAtWriteSite(t, status)
}

// TestDecidedCallIsNotRetracted proves a user decision resolves a request, so the
// reconciler never also retracts it (decisions and retractions are mutually
// exclusive terminal transitions).
func TestDecidedCallIsNotRetracted(t *testing.T) {
	waiting := agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL
	unspecified := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED
	approve := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE

	status := statusWith([]*agentexecutionv1.AgentMessage{
		makeAIMessage(makeToolCall("tc1", "shell", waiting, true, unspecified)),
	}, nil)
	status.Phase = agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL
	EnsureApprovalRequests(status, "exec-1")

	// Decide it (like SubmitApproval): record decision, then the call advances.
	tc1 := status.Messages[0].ToolCalls[0]
	tc1.ApprovalAction = approve
	tc1.ApprovalDecidedAt = "2026-03-27T10:05:00Z"
	RecordDecisionEvent(status, tc1, "alice", "ok")
	tc1.Status = agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED

	EnsureApprovalRequests(status, "exec-1")

	if retractionFor(status.GetApprovalEventStream(), "tc1") != nil {
		t.Error("a decided call must never be retracted")
	}
	if got := countEvents(status.GetApprovalEventStream(), agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_APPROVED); got != 1 {
		t.Errorf("APPROVED count = %d, want 1", got)
	}
	assertEqualityAtWriteSite(t, status)
}

// TestTerminalExecutionProjectsEmpty is the pre-existing parity-bug fix: a FAILED
// execution that still carries a gated tool call (the failed-at-gate case where no
// message wipe happened) must project zero pending — and the reconciler must NOT
// author a per-call retraction for it (terminal is handled by the phase-aware
// seam, not the ledger).
func TestTerminalExecutionProjectsEmpty(t *testing.T) {
	waiting := agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL
	unspecified := agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED

	status := statusWith([]*agentexecutionv1.AgentMessage{
		makeAIMessage(makeToolCall("tc1", "shell", waiting, true, unspecified)),
	}, nil)
	status.Phase = agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL
	EnsureApprovalRequests(status, "exec-1")

	// The execution fails while parked at the gate; the gated call survives in the
	// transcript (no message wipe).
	status.Phase = agentexecutionv1.ExecutionPhase_EXECUTION_FAILED
	EnsureApprovalRequests(status, "exec-1")

	if got := countEvents(status.GetApprovalEventStream(), agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_RETRACTED); got != 0 {
		t.Errorf("RETRACTED count = %d, want 0 (terminal handled by the seam, not retraction)", got)
	}
	got := ProjectPendingApprovals(status.GetPhase(), status.GetMessages(), status.GetSubAgentExecutions(), status.GetApprovalEventStream())
	if len(got) != 0 {
		t.Errorf("FAILED-at-gate execution projects %d pending, want 0 (parity-bug fix)", len(got))
	}
}

// Multi-step adversarial sequences (the persisted-append coverage the
// fresh-EmitApprovalEvents corpus structurally cannot give) now live in the
// shared cross-edition corpus apis/testdata/hitl/sequences, replayed by both
// TestSequenceCorpus (Go) and SequenceFixtureTest (Java). The unit-level
// retraction invariants above stay here; the former in-code TestStatefulSequenceParity
// was a second, drift-prone copy of corpus sequence 01 and was removed in favor
// of the single shared source.

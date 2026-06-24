package approval

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// This file authors the PERSISTED approval-event stream
// (AgentExecutionStatus.approval_event_stream). It is the write side that turns
// the previously shadow-only stream (emit.go) into a real, server-written record.
//
// Two commands, one writer per event type:
//   - EnsureApprovalRequests authors REQUESTED events (the UpdateStatus handlers
//     own it; it also seeds the stream once for executions that predate the
//     field) and, on the same pass, authors RETRACTED events for in-flight
//     orphans so the lifecycle is total (see reconcileRetractions).
//   - RecordDecisionEvent authors a single decision event (the SubmitApproval
//     handler owns it, carrying decided_by + the user's comment).
//
// Every append is keyed by the deterministic ApprovalEvent.event_id, so both
// commands are idempotent under retries and a rich decision event — written in
// the same operation that records the decision on the message scan — can never be
// duplicated or clobbered by the coarse decision the seed derives. The projection
// seam (project.go) stays a pure read over whatever these commands have written.

// EnsureApprovalRequests records a REQUESTED event for every tool call currently
// in the approval gate, mutating status.approval_event_stream in place. It is the
// sole writer of REQUESTED events and is called at every UpdateStatus site and at
// the start of the SubmitApproval transaction (before the decision is recorded,
// so a request always precedes its decision).
//
// When the stream is empty it is seeded once from the authoritative message scan
// (EmitApprovalEvents): for a new execution that is just the REQUESTED events; for
// an execution that predates this field it is REQUESTED plus the coarse decisions
// already recorded on the scan, so the ledger is consistent from first touch
// without emitting spurious projection-divergence warnings. Thereafter only
// REQUESTED events are appended (decisions are authored by RecordDecisionEvent),
// keeping the parity check a real cross-writer guard rather than a tautology.
//
// executionID stamps the stream's identity on first seed; it is informational and
// never used for correlation (that is approval_request_id == tool_call_id).
func EnsureApprovalRequests(status *agentexecutionv1.AgentExecutionStatus, executionID string) {
	if status == nil {
		return
	}

	stream := status.GetApprovalEventStream()
	if stream == nil || len(stream.GetEvents()) == 0 {
		seeded := EmitApprovalEvents(status.GetMessages(), status.GetSubAgentExecutions())
		seeded.ExecutionId = executionID
		status.ApprovalEventStream = seeded
		return
	}

	seen := eventIDSet(stream)
	appendRequestedIfAbsent(stream, seen, status.GetMessages(), false, "", "")
	for _, sa := range status.GetSubAgentExecutions() {
		// Mirror the scan and the seed: a terminal sub-agent's gated tool calls
		// are orphans and must not surface, so never author requests for them.
		if isTerminalSubAgent(sa.GetStatus()) {
			continue
		}
		appendRequestedIfAbsent(stream, seen, sa.GetMessages(), true, sa.GetName(), sa.GetSubject())
	}

	reconcileRetractions(status, stream, seen)
}

// reconcileRetractions completes the approval lifecycle by authoring a RETRACTED
// event for every in-flight per-call orphan: a REQUESTED whose gated call has
// left the gate WITHOUT a user decision while the execution is still live (its
// sub-agent reached a terminal state, or the harness superseded the call on
// resume). Without this, the append-only stream would keep the orphan REQUESTED
// forever and the event-stream projection would report a phantom pending approval
// the message scan already dropped — the exact divergence the eventual flip must
// not inherit.
//
// It is the mirror image of the message scan's two non-decision exits: the scan
// drops a call whose enclosing sub-agent went terminal (compute.go
// isTerminalSubAgent) or whose status advanced off WAITING_APPROVAL; this authors
// the matching terminal event so ComputePendingApprovalsFromEvents drops it too.
//
// Two invariants keep it from ever OVER-retracting (which would crash a parked
// execution to FAILED via the WAITING ⟺ ≥1 pending fail-fast):
//   - Terminal executions are skipped entirely — they project to empty via the
//     phase-aware seam, so a dangling REQUESTED on a dead execution is explained
//     by the phase, not an orphan to retract.
//   - A call still in the gate (present in the scan) or already resolved (a
//     decision or prior retraction exists) is never retracted. In particular, the
//     SubmitApproval pre-decision ensure runs while the clicked and APPROVE_ALL
//     co-pending calls are still gated, so they are never false-retracted.
func reconcileRetractions(
	status *agentexecutionv1.AgentExecutionStatus,
	stream *agentexecutionv1.ApprovalEventStream,
	seen map[string]struct{},
) {
	if isTerminalExecution(status.GetPhase()) {
		return
	}

	gated := gatedToolCallIDs(status)
	resolved := resolvedRequestIDs(stream)

	// Snapshot the events: we append retractions below, and ranging the original
	// slice keeps the pass from considering its own output.
	original := stream.GetEvents()
	for _, ev := range original {
		if ev.GetEventType() != agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_REQUESTED {
			continue
		}
		reqID := ev.GetApprovalRequestId()
		if _, stillGated := gated[reqID]; stillGated {
			continue
		}
		if _, done := resolved[reqID]; done {
			continue
		}
		event := buildRetractionEvent(reqID, retractionReason(status, reqID))
		if _, ok := seen[event.GetEventId()]; ok {
			continue
		}
		stream.Events = append(stream.Events, event)
		seen[event.GetEventId()] = struct{}{}
	}
}

// gatedToolCallIDs is the set of tool_call_ids still in the approval gate per the
// authoritative message scan — i.e. the REQUESTED events that must NOT be
// retracted. reconcileRetractions only runs for non-terminal executions, where
// the scan is the exact live gate set.
func gatedToolCallIDs(status *agentexecutionv1.AgentExecutionStatus) map[string]struct{} {
	pending := ComputePendingApprovals(status.GetMessages(), status.GetSubAgentExecutions())
	ids := make(map[string]struct{}, len(pending))
	for _, pa := range pending {
		ids[pa.GetToolCallId()] = struct{}{}
	}
	return ids
}

// resolvedRequestIDs is the set of approval_request_ids already carrying a
// terminal event — a user decision (APPROVED/REJECTED/SKIPPED) or a prior
// RETRACTED — so reconcileRetractions never double-resolves an approval.
func resolvedRequestIDs(stream *agentexecutionv1.ApprovalEventStream) map[string]struct{} {
	resolved := make(map[string]struct{})
	for _, ev := range stream.GetEvents() {
		if isResolvingEvent(ev.GetEventType()) {
			resolved[ev.GetApprovalRequestId()] = struct{}{}
		}
	}
	return resolved
}

// retractionReason classifies why an in-flight request was orphaned, for the
// audit trail only. A call still located inside a now-terminal sub-agent was
// orphaned by that sub-agent finishing; anything else (a root call, or a call
// whose status advanced off WAITING_APPROVAL) was superseded.
func retractionReason(
	status *agentexecutionv1.AgentExecutionStatus,
	requestID string,
) agentexecutionv1.ApprovalRetractionReason {
	for _, sa := range status.GetSubAgentExecutions() {
		for _, msg := range sa.GetMessages() {
			for _, tc := range msg.GetToolCalls() {
				if tc.GetId() == requestID {
					if isTerminalSubAgent(sa.GetStatus()) {
						return agentexecutionv1.ApprovalRetractionReason_APPROVAL_RETRACTION_REASON_SUB_AGENT_TERMINAL
					}
					return agentexecutionv1.ApprovalRetractionReason_APPROVAL_RETRACTION_REASON_SUPERSEDED
				}
			}
		}
	}
	return agentexecutionv1.ApprovalRetractionReason_APPROVAL_RETRACTION_REASON_SUPERSEDED
}

func appendRequestedIfAbsent(
	stream *agentexecutionv1.ApprovalEventStream,
	seen map[string]struct{},
	messages []*agentexecutionv1.AgentMessage,
	fromSubAgent bool,
	subAgentName, subAgentSubject string,
) {
	for _, msg := range messages {
		for _, tc := range msg.GetToolCalls() {
			if !isGatedToolCall(tc) {
				continue
			}
			event := buildRequestedEvent(tc, fromSubAgent, subAgentName, subAgentSubject)
			if _, ok := seen[event.GetEventId()]; ok {
				continue
			}
			stream.Events = append(stream.Events, event)
			seen[event.GetEventId()] = struct{}{}
		}
	}
}

// RecordDecisionEvent appends the decision event for a single decided tool call,
// carrying decided_by and the user's comment. It is the sole writer of decision
// events (the SubmitApproval handler), called once for the clicked tool call (with
// the comment) and once per co-pending tool call an APPROVE_ALL bulk-approves
// (with an empty comment — the escalation comment belongs to the clicked tool).
//
// It is a no-op when the tool call carries no decision, and append-if-absent by
// event_id so a repeated submit or a later coarse seed never double-records.
func RecordDecisionEvent(
	status *agentexecutionv1.AgentExecutionStatus,
	tc *agentexecutionv1.ToolCall,
	decidedBy, comment string,
) {
	if status == nil {
		return
	}
	event := buildDecisionEvent(tc, decidedBy, comment)
	if event == nil {
		return
	}

	stream := status.GetApprovalEventStream()
	if stream == nil {
		stream = &agentexecutionv1.ApprovalEventStream{}
		status.ApprovalEventStream = stream
	}
	if hasEvent(stream, event.GetEventId()) {
		return
	}
	stream.Events = append(stream.Events, event)
}

// eventIDSet indexes a stream's events by event_id for append-if-absent checks.
func eventIDSet(stream *agentexecutionv1.ApprovalEventStream) map[string]struct{} {
	seen := make(map[string]struct{}, len(stream.GetEvents()))
	for _, ev := range stream.GetEvents() {
		seen[ev.GetEventId()] = struct{}{}
	}
	return seen
}

func hasEvent(stream *agentexecutionv1.ApprovalEventStream, eventID string) bool {
	for _, ev := range stream.GetEvents() {
		if ev.GetEventId() == eventID {
			return true
		}
	}
	return false
}

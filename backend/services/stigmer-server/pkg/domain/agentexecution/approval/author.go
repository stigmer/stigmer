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
//     field).
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

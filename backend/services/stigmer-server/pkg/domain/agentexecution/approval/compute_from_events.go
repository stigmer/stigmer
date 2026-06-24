package approval

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// ComputePendingApprovalsFromEvents projects pending approvals from the
// append-only approval-event stream: every REQUESTED event whose approval has
// not been resolved by a later terminal event — a user decision
// (APPROVED/REJECTED/SKIPPED) or a system RETRACTED.
//
// This is the read side of the shadow projection. For a given execution it must
// produce the same set as ComputePendingApprovals (the message scan);
// ProjectPendingApprovals asserts that equality in production and the fixture
// corpus asserts it in CI. The RETRACTED resolution is what lets the two agree
// for the in-flight orphan exits the scan handles structurally (a terminal
// sub-agent's calls, or a call whose status advanced) — see reconcileRetractions.
// Terminal-execution gate-exits are handled one level up, by the phase-aware
// seam, not here. Correlation is by approval_request_id (today, the tool_call_id).
func ComputePendingApprovalsFromEvents(
	stream *agentexecutionv1.ApprovalEventStream,
) []*agentexecutionv1.PendingApproval {
	if stream == nil {
		return nil
	}

	resolved := make(map[string]struct{})
	for _, ev := range stream.GetEvents() {
		if isResolvingEvent(ev.GetEventType()) {
			resolved[ev.GetApprovalRequestId()] = struct{}{}
		}
	}

	var result []*agentexecutionv1.PendingApproval
	for _, ev := range stream.GetEvents() {
		if ev.GetEventType() != agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_REQUESTED {
			continue
		}
		if _, done := resolved[ev.GetApprovalRequestId()]; done {
			continue
		}
		if req := ev.GetRequested(); req != nil {
			result = append(result, pendingApprovalFromRequest(req))
		}
	}
	return result
}

// isResolvingEvent reports whether an event type terminally resolves a REQUESTED:
// the three user decisions plus the system RETRACTED. A resolved request never
// appears in the pending projection.
func isResolvingEvent(t agentexecutionv1.ApprovalEventType) bool {
	switch t {
	case agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_APPROVED,
		agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_REJECTED,
		agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_SKIPPED,
		agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_RETRACTED:
		return true
	default:
		return false
	}
}

// pendingApprovalFromRequest reconstructs a PendingApproval from a REQUESTED
// event's payload. ApprovalRequest intentionally carries the same display fields
// as PendingApproval so this projection needs no join back to the ToolCall.
func pendingApprovalFromRequest(req *agentexecutionv1.ApprovalRequest) *agentexecutionv1.PendingApproval {
	return &agentexecutionv1.PendingApproval{
		ToolCallId:      req.GetToolCallId(),
		ToolName:        req.GetToolName(),
		Message:         req.GetMessage(),
		ArgsPreview:     req.GetArgsPreview(),
		RequestedAt:     req.GetRequestedAt(),
		FromSubAgent:    req.GetFromSubAgent(),
		SubAgentName:    req.GetSubAgentName(),
		SubAgentSubject:      req.GetSubAgentSubject(),
		McpServerSlug:        req.GetMcpServerSlug(),
		ToolKind:             req.GetToolKind(),
		ApprovalPolicySource: req.GetApprovalPolicySource(),
		FileChanges:          req.GetFileChanges(),
	}
}

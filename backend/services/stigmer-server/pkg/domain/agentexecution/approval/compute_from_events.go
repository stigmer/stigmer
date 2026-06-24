package approval

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// ComputePendingApprovalsFromEvents projects pending approvals from the
// append-only approval-event stream: every REQUESTED event whose approval has
// not been resolved by a later decision event.
//
// This is the read side of the Phase-1 shadow projection. For a given execution
// it must produce the same set as ComputePendingApprovals (the message scan);
// ProjectPendingApprovals asserts that equality in production and the fixture
// corpus asserts it in CI. Correlation is by approval_request_id (in Phase 1,
// the tool_call_id).
func ComputePendingApprovalsFromEvents(
	stream *agentexecutionv1.ApprovalEventStream,
) []*agentexecutionv1.PendingApproval {
	if stream == nil {
		return nil
	}

	decided := make(map[string]struct{})
	for _, ev := range stream.GetEvents() {
		if isDecisionEvent(ev.GetEventType()) {
			decided[ev.GetApprovalRequestId()] = struct{}{}
		}
	}

	var result []*agentexecutionv1.PendingApproval
	for _, ev := range stream.GetEvents() {
		if ev.GetEventType() != agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_REQUESTED {
			continue
		}
		if _, resolved := decided[ev.GetApprovalRequestId()]; resolved {
			continue
		}
		if req := ev.GetRequested(); req != nil {
			result = append(result, pendingApprovalFromRequest(req))
		}
	}
	return result
}

func isDecisionEvent(t agentexecutionv1.ApprovalEventType) bool {
	switch t {
	case agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_APPROVED,
		agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_REJECTED,
		agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_SKIPPED:
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

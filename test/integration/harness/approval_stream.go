package harness

import (
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// ApprovalStreamHasEvent reports whether the persisted, append-only
// approval-event stream contains an event of the given type for the given
// approval request (the approval_request_id equals the gated tool_call_id).
//
// The stream is the server-authored audit ledger that the source-of-truth flip
// projects pending_approvals from. Both the live and offline HITL suites assert
// against it, so the predicate lives here once rather than being copied per
// suite.
func ApprovalStreamHasEvent(
	stream *agentexecv1.ApprovalEventStream,
	approvalRequestID string,
	eventType agentexecv1.ApprovalEventType,
) bool {
	for _, ev := range stream.GetEvents() {
		if ev.GetApprovalRequestId() == approvalRequestID && ev.GetEventType() == eventType {
			return true
		}
	}
	return false
}

package approval

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// Actors for approval events. REQUESTED is raised by the platform when a gated
// tool call appears; decisions are attributed to the user.
const (
	actorSystem = "system"
	actorUser   = "user"
)

// EmitApprovalEvents derives a complete append-only approval-event stream from
// the same authoritative tool-call state that ComputePendingApprovals scans.
//
// It is the seed for the persisted stream: EnsureApprovalRequests (author.go)
// calls it once when an execution's stream is empty, so a new execution starts
// with its REQUESTED events and an execution that predates the persisted field
// gets a consistent ledger (REQUESTED plus the coarse decisions already on the
// scan) without spurious projection-divergence warnings. The decisions it derives
// are coarse (no decided_by/comment); the rich decision is authored separately by
// RecordDecisionEvent and wins via append-if-absent.
//
// It reproduces the scan's rules exactly — a REQUESTED event for every
// WAITING_APPROVAL tool call that requires approval, a decision event for every
// such call that already carries an approval_action, and the same terminal
// sub-agent exclusion (orphaned approvals inside a finished sub-agent never
// surface) — so ComputePendingApprovalsFromEvents over the seed equals the scan.
func EmitApprovalEvents(
	messages []*agentexecutionv1.AgentMessage,
	subAgentExecutions []*agentexecutionv1.SubAgentExecution,
) *agentexecutionv1.ApprovalEventStream {
	stream := &agentexecutionv1.ApprovalEventStream{}

	for _, msg := range messages {
		for _, tc := range msg.GetToolCalls() {
			appendToolCallEvents(stream, tc, false, "", "")
		}
	}

	for _, sa := range subAgentExecutions {
		// Mirror ComputePendingApprovals: a terminal sub-agent's WAITING_APPROVAL
		// tool calls are orphans and must not produce events either.
		if isTerminalSubAgent(sa.GetStatus()) {
			continue
		}
		saName := sa.GetName()
		saSubject := sa.GetSubject()
		for _, msg := range sa.GetMessages() {
			for _, tc := range msg.GetToolCalls() {
				appendToolCallEvents(stream, tc, true, saName, saSubject)
			}
		}
	}

	return stream
}

func appendToolCallEvents(
	stream *agentexecutionv1.ApprovalEventStream,
	tc *agentexecutionv1.ToolCall,
	fromSubAgent bool,
	subAgentName, subAgentSubject string,
) {
	// Only tool calls that actually entered the approval gate produce events — a
	// call that never required approval is invisible to the stream, exactly as it
	// is to the message scan.
	if !isGatedToolCall(tc) {
		return
	}

	stream.Events = append(stream.Events, buildRequestedEvent(tc, fromSubAgent, subAgentName, subAgentSubject))

	// The shadow seed carries a coarse decision (no decided_by/comment); the
	// authoritative rich decision is authored by SubmitApproval via
	// RecordDecisionEvent (author.go). Append-if-absent by event_id guarantees
	// the rich one, written in the same op that records the decision, always wins.
	if decided := buildDecisionEvent(tc, "", ""); decided != nil {
		stream.Events = append(stream.Events, decided)
	}
}

// isGatedToolCall reports whether a tool call has entered the approval gate, i.e.
// it is the single condition under which a tool call produces approval events.
// It is the exact gate the message scan uses (compute.go projectToolCall), minus
// the decision check — a gated call produces a REQUESTED event whether or not a
// decision has since been recorded.
func isGatedToolCall(tc *agentexecutionv1.ToolCall) bool {
	return tc.GetStatus() == agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL &&
		tc.GetRequiresApproval()
}

// buildRequestedEvent constructs the REQUESTED event for a gated tool call.
// Callers must have confirmed isGatedToolCall(tc).
//
// approval_request_id equals the harness tool_call_id by a deliberate, documented
// decision (see the "approval-request-id-equals-tool-call-id" HITL design
// decision): tool_call_id is already a stable, run-unique correlation key, so a
// separately minted id would be parallel state with no reader — and a random one
// would break the lock-free Cloud write model. It is never a content hash. The
// ApprovalRequest payload carries the same display fields as PendingApproval so
// the event-stream projection reconstructs the identical PendingApproval the
// message scan does (compute.go), without joining back to the ToolCall.
func buildRequestedEvent(
	tc *agentexecutionv1.ToolCall,
	fromSubAgent bool,
	subAgentName, subAgentSubject string,
) *agentexecutionv1.ApprovalEvent {
	requestID := tc.GetId()
	return &agentexecutionv1.ApprovalEvent{
		EventId:           eventID(requestID, agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_REQUESTED),
		ApprovalRequestId: requestID,
		EventType:         agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_REQUESTED,
		Timestamp:         tc.GetApprovalRequestedAt(),
		Actor:             actorSystem,
		Payload: &agentexecutionv1.ApprovalEvent_Requested{Requested: &agentexecutionv1.ApprovalRequest{
			ApprovalRequestId: requestID,
			ToolCallId:        tc.GetId(),
			RequestedAt:       tc.GetApprovalRequestedAt(),
			ToolName:          tc.GetName(),
			Message:           tc.GetApprovalMessage(),
			ArgsPreview:       tc.GetArgsPreview(),
			FromSubAgent:      fromSubAgent,
			SubAgentName:      subAgentName,
			SubAgentSubject:   subAgentSubject,
			McpServerSlug:     tc.GetMcpServerSlug(),
			ToolKind:          tc.GetToolKind(),
			// Carried so the authoritative event-stream projection reconstructs the
			// same PendingApproval the message-scan cross-check does (compute.go) —
			// keeps ProjectPendingApprovals fromEvents == fromScan.
			ApprovalPolicySource: tc.GetApprovalPolicySource(),
			FileChanges:          tc.GetFileChanges(),
		}},
	}
}

// buildDecisionEvent constructs the decision event for a tool call that carries
// an approval_action, or returns nil when no decision has been recorded.
//
// decidedBy and comment are the audit metadata the flat ToolCall fields cannot
// hold; the shadow seed (emit.go) passes them empty, while SubmitApproval passes
// the real decider and the user's comment (author.go). The coarse event_type
// buckets APPROVE_ALL as APPROVED; the precise action survives on the payload's
// ApprovalDecision.action.
func buildDecisionEvent(tc *agentexecutionv1.ToolCall, decidedBy, comment string) *agentexecutionv1.ApprovalEvent {
	action := tc.GetApprovalAction()
	if action == agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED {
		return nil
	}

	requestID := tc.GetId()
	eventType := decisionEventType(action)
	return &agentexecutionv1.ApprovalEvent{
		EventId:           eventID(requestID, eventType),
		ApprovalRequestId: requestID,
		EventType:         eventType,
		Timestamp:         tc.GetApprovalDecidedAt(),
		Actor:             actorUser,
		Payload: &agentexecutionv1.ApprovalEvent_Decided{Decided: &agentexecutionv1.ApprovalDecision{
			ApprovalRequestId: requestID,
			Action:            action,
			DecidedAt:         tc.GetApprovalDecidedAt(),
			DecidedBy:         decidedBy,
			Comment:           comment,
		}},
	}
}

// buildRetractionEvent constructs the terminal RETRACTED event for an in-flight
// orphaned request (see reconcileRetractions). It is reconciler-authored, not
// derived from a tool-call field, so it carries no source timestamp: retracted_at
// is left empty and ordering is conveyed by the event's position after its
// REQUESTED in the append-only stream. An empty timestamp is also what keeps the
// event byte-for-byte identical across the Go and Java editions for the shared
// HITL corpus — a clock would diverge them. The deterministic event_id
// (request_id:RETRACTED) makes authoring idempotent.
func buildRetractionEvent(
	requestID string,
	reason agentexecutionv1.ApprovalRetractionReason,
) *agentexecutionv1.ApprovalEvent {
	return &agentexecutionv1.ApprovalEvent{
		EventId:           eventID(requestID, agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_RETRACTED),
		ApprovalRequestId: requestID,
		EventType:         agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_RETRACTED,
		Actor:             actorSystem,
		Payload: &agentexecutionv1.ApprovalEvent_Retracted{Retracted: &agentexecutionv1.ApprovalRetraction{
			ApprovalRequestId: requestID,
			Reason:            reason,
		}},
	}
}

// decisionEventType maps a precise ApprovalAction to the coarse lifecycle bucket
// carried on ApprovalEvent.event_type; APPROVE_ALL buckets as APPROVED (the
// precise action survives on ApprovalDecision.action).
func decisionEventType(action agentexecutionv1.ApprovalAction) agentexecutionv1.ApprovalEventType {
	switch action {
	case agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecutionv1.ApprovalAction_APPROVAL_ACTION_APPROVE_ALL:
		return agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_APPROVED
	case agentexecutionv1.ApprovalAction_APPROVAL_ACTION_SKIP:
		return agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_SKIPPED
	case agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT:
		return agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_REJECTED
	default:
		return agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_UNSPECIFIED
	}
}

// eventID derives a deterministic event id from (request_id, type). This is the
// permanent idempotency anchor for append-only authoring, not a provisional
// scheme: a single approval has at most one event per type, so (request_id, type)
// is unique and re-deriving or re-authoring the stream never duplicates an event.
func eventID(requestID string, eventType agentexecutionv1.ApprovalEventType) string {
	return requestID + ":" + eventType.String()
}

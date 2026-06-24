package approval

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// Phase-1 actors for approval events. REQUESTED is raised by the platform when a
// gated tool call appears; decisions are attributed to the user.
const (
	actorSystem = "system"
	actorUser   = "user"
)

// EmitApprovalEvents derives an append-only approval-event stream from the same
// authoritative tool-call state that ComputePendingApprovals scans.
//
// This is the Phase-1 bridge: the stream is computed in shadow beside the
// message scan so the two can be compared for parity (see ProjectPendingApprovals)
// before the source of truth ever flips. It therefore reproduces the scan's
// rules exactly — a REQUESTED event for every WAITING_APPROVAL tool call that
// requires approval, a decision event for every such call that already carries
// an approval_action, and the same terminal-sub-agent exclusion (orphaned
// approvals inside a finished sub-agent never surface).
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
	if tc.GetStatus() != agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL {
		return
	}
	if !tc.GetRequiresApproval() {
		return
	}

	// Phase 1: events are derived from a single tool call, so the harness
	// tool_call_id is a stable, deterministic correlation id. Correlation is
	// never a content hash. A later phase authors a UUID when SubmitApproval
	// emits events directly.
	requestID := tc.GetId()

	request := &agentexecutionv1.ApprovalRequest{
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
		FileChanges:       tc.GetFileChanges(),
	}
	stream.Events = append(stream.Events, &agentexecutionv1.ApprovalEvent{
		EventId:           eventID(requestID, agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_REQUESTED),
		ApprovalRequestId: requestID,
		EventType:         agentexecutionv1.ApprovalEventType_APPROVAL_EVENT_TYPE_REQUESTED,
		Timestamp:         tc.GetApprovalRequestedAt(),
		Actor:             actorSystem,
		Payload:           &agentexecutionv1.ApprovalEvent_Requested{Requested: request},
	})

	action := tc.GetApprovalAction()
	if action == agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED {
		return
	}

	eventType := decisionEventType(action)
	stream.Events = append(stream.Events, &agentexecutionv1.ApprovalEvent{
		EventId:           eventID(requestID, eventType),
		ApprovalRequestId: requestID,
		EventType:         eventType,
		Timestamp:         tc.GetApprovalDecidedAt(),
		Actor:             actorUser,
		Payload: &agentexecutionv1.ApprovalEvent_Decided{Decided: &agentexecutionv1.ApprovalDecision{
			ApprovalRequestId: requestID,
			Action:            action,
			DecidedAt:         tc.GetApprovalDecidedAt(),
		}},
	})
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

// eventID derives a deterministic event id so re-deriving the shadow stream from
// the same tool calls yields stable ids (no churn between projections). A single
// approval has at most one event per type, so (request_id, type) is unique.
func eventID(requestID string, eventType agentexecutionv1.ApprovalEventType) string {
	return requestID + ":" + eventType.String()
}

package approval

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// ComputePendingApprovals scans messages and sub-agent messages for tool calls
// that are waiting for approval and projects them into PendingApproval entries.
//
// A tool call qualifies if:
//   - status == TOOL_CALL_WAITING_APPROVAL
//   - requires_approval == true
//   - approval_action == APPROVAL_ACTION_UNSPECIFIED (no decision recorded yet)
//
// This replaces the merge-based approach: pending_approvals are always
// recomputed from the authoritative tool call state in messages.
func ComputePendingApprovals(
	messages []*agentexecutionv1.AgentMessage,
	subAgentExecutions []*agentexecutionv1.SubAgentExecution,
) []*agentexecutionv1.PendingApproval {
	var result []*agentexecutionv1.PendingApproval

	for _, msg := range messages {
		for _, tc := range msg.GetToolCalls() {
			if pa := projectToolCall(tc, false, "", ""); pa != nil {
				result = append(result, pa)
			}
		}
	}

	for _, sa := range subAgentExecutions {
		if isTerminalSubAgent(sa.GetStatus()) {
			continue
		}
		saName := sa.GetName()
		saSubject := sa.GetSubject()
		for _, msg := range sa.GetMessages() {
			for _, tc := range msg.GetToolCalls() {
				if pa := projectToolCall(tc, true, saName, saSubject); pa != nil {
					result = append(result, pa)
				}
			}
		}
	}

	return result
}

// isTerminalSubAgent returns true for sub-agents that have reached a final
// lifecycle state.  Any WAITING_APPROVAL tool calls left inside a terminal
// sub-agent are orphans and must not appear in pending_approvals.
func isTerminalSubAgent(status agentexecutionv1.SubAgentStatus) bool {
	switch status {
	case agentexecutionv1.SubAgentStatus_SUB_AGENT_COMPLETED,
		agentexecutionv1.SubAgentStatus_SUB_AGENT_FAILED,
		agentexecutionv1.SubAgentStatus_SUB_AGENT_CANCELLED:
		return true
	default:
		return false
	}
}

func projectToolCall(tc *agentexecutionv1.ToolCall, fromSubAgent bool, subAgentName, subAgentSubject string) *agentexecutionv1.PendingApproval {
	if tc.GetStatus() != agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL {
		return nil
	}
	if !tc.GetRequiresApproval() {
		return nil
	}
	if tc.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED {
		return nil
	}

	return &agentexecutionv1.PendingApproval{
		ToolCallId:   tc.GetId(),
		ToolName:     tc.GetName(),
		Message:      tc.GetApprovalMessage(),
		ArgsPreview:  tc.GetArgsPreview(),
		RequestedAt:  tc.GetApprovalRequestedAt(),
		FromSubAgent: fromSubAgent,
		SubAgentName: subAgentName,
		// Mirrors Java PendingApprovalComputer: the sub-agent's task subject lets
		// approval surfaces label the card with the task ("Explore CLI rendering")
		// instead of the generic agent type. Empty for root tool calls.
		SubAgentSubject: subAgentSubject,
		McpServerSlug:   tc.GetMcpServerSlug(),
		// Denormalized for approval surfaces (like McpServerSlug above) so the
		// approval UI classifies the tool without re-deriving it from the name.
		ToolKind: tc.GetToolKind(),
		// Denormalized so the gate can render an inline before/after diff without
		// correlating back to the originating ToolCall (which, for workflow-parent
		// approvals, is not co-located with the approval). The runner captures
		// these at approval-request time; large bodies are already offloaded to
		// FileContent.ref before this projection runs.
		FileChanges: tc.GetFileChanges(),
	}
}

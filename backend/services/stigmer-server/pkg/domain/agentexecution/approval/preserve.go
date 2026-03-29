package approval

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// PreserveApprovalFields copies SubmitApproval-owned fields from existing
// (DB-loaded) tool calls onto incoming (Python-sent) tool calls that have
// UNSPECIFIED approval_action. This prevents update_status from overwriting
// approval decisions that were atomically recorded by SubmitApproval.
//
// The three preserved fields are:
//   - approval_action
//   - approval_decided_at
//   - approved_by
//
// Tool call IDs are unique across root and sub-agent messages, so a flat
// index is used for lookup. Incoming tool calls that already have a
// non-UNSPECIFIED approval_action are left untouched.
func PreserveApprovalFields(
	incomingMessages []*agentexecutionv1.AgentMessage,
	incomingSubAgents []*agentexecutionv1.SubAgentExecution,
	existingMessages []*agentexecutionv1.AgentMessage,
	existingSubAgents []*agentexecutionv1.SubAgentExecution,
) {
	index := buildApprovalIndex(existingMessages, existingSubAgents)
	if len(index) == 0 {
		return
	}

	applyApprovalFields(incomingMessages, index)
	for _, sa := range incomingSubAgents {
		applyApprovalFields(sa.GetMessages(), index)
	}
}

// approvalSnapshot holds the three fields owned by SubmitApproval.
type approvalSnapshot struct {
	action     agentexecutionv1.ApprovalAction
	decidedAt  string
	approvedBy string
}

// buildApprovalIndex scans existing messages (root + sub-agent) and returns
// a map of tool_call_id -> approval snapshot for tool calls that have a
// recorded approval decision.
func buildApprovalIndex(
	messages []*agentexecutionv1.AgentMessage,
	subAgentExecutions []*agentexecutionv1.SubAgentExecution,
) map[string]approvalSnapshot {
	index := make(map[string]approvalSnapshot)

	collectFromMessages(messages, index)
	for _, sa := range subAgentExecutions {
		collectFromMessages(sa.GetMessages(), index)
	}

	return index
}

func collectFromMessages(messages []*agentexecutionv1.AgentMessage, index map[string]approvalSnapshot) {
	for _, msg := range messages {
		for _, tc := range msg.GetToolCalls() {
			if tc.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED {
				index[tc.GetId()] = approvalSnapshot{
					action:     tc.GetApprovalAction(),
					decidedAt:  tc.GetApprovalDecidedAt(),
					approvedBy: tc.GetApprovedBy(),
				}
			}
		}
	}
}

func applyApprovalFields(messages []*agentexecutionv1.AgentMessage, index map[string]approvalSnapshot) {
	for _, msg := range messages {
		for _, tc := range msg.GetToolCalls() {
			snap, ok := index[tc.GetId()]
			if !ok {
				continue
			}
			if tc.GetApprovalAction() != agentexecutionv1.ApprovalAction_APPROVAL_ACTION_UNSPECIFIED {
				continue
			}
			tc.ApprovalAction = snap.action
			tc.ApprovalDecidedAt = snap.decidedAt
			tc.ApprovedBy = snap.approvedBy
		}
	}
}

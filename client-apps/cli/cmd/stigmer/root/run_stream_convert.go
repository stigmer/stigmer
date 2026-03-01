package root

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// convertToolCalls converts a slice of proto ToolCalls to toolrender.ToolCallInfo.
// Reuses the existing convertToolCall bridge function from run_display_tools.go.
func convertToolCalls(toolCalls []*agentexecutionv1.ToolCall) []toolrender.ToolCallInfo {
	if len(toolCalls) == 0 {
		return nil
	}
	result := make([]toolrender.ToolCallInfo, len(toolCalls))
	for i, tc := range toolCalls {
		result[i] = convertToolCall(tc)
	}
	return result
}

// mapPhaseToString converts a proto ExecutionPhase to a human-readable string
// used by the TUI event types.
func mapPhaseToString(phase agentexecutionv1.ExecutionPhase) string {
	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_PENDING:
		return "pending"
	case agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS:
		return "in_progress"
	case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		return "completed"
	case agentexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		return "failed"
	case agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		return "cancelled"
	case agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL:
		return "waiting_for_approval"
	case agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED:
		return "terminated"
	default:
		return "unknown"
	}
}

// mapApprovalResponseToDecision converts a TUI ApprovalResponse to the
// pkg/approval.Decision type used by the submission API.
func mapApprovalResponseToDecision(resp executiontui.ApprovalResponse) *approval.Decision {
	var action approval.Action
	switch resp.Action {
	case "approve":
		action = approval.ActionApprove
	case "skip":
		action = approval.ActionSkip
	case "reject":
		action = approval.ActionReject
	default:
		action = approval.ActionSkip // safe default
	}
	return &approval.Decision{Action: action, Comment: resp.Comment}
}

// findToolCallByID finds a tool call by its ID, searching top-level tool calls
// first, then falling back to sub-agent tool calls. This ensures sub-agent
// tools (which live in SubAgentExecution.ToolCalls, not the top-level list)
// are found when processing approval events.
func findToolCallByID(
	toolCalls []*agentexecutionv1.ToolCall,
	subAgents []*agentexecutionv1.SubAgentExecution,
	id string,
) *agentexecutionv1.ToolCall {
	for _, tc := range toolCalls {
		if tc.Id == id {
			return tc
		}
	}
	for _, sa := range subAgents {
		for _, tc := range sa.ToolCalls {
			if tc.Id == id {
				return tc
			}
		}
	}
	return nil
}

// mapTodoStatus converts a proto TodoStatus enum to the string representation
// used by the TUI domain types. UNSPECIFIED maps to "pending" as a safe
// fallback — the renderer shows an open circle, which is the least misleading
// state for an unknown item.
func mapTodoStatus(status agentexecutionv1.TodoStatus) string {
	switch status {
	case agentexecutionv1.TodoStatus_TODO_PENDING:
		return "pending"
	case agentexecutionv1.TodoStatus_TODO_IN_PROGRESS:
		return "in_progress"
	case agentexecutionv1.TodoStatus_TODO_COMPLETED:
		return "completed"
	case agentexecutionv1.TodoStatus_TODO_CANCELLED:
		return "cancelled"
	default:
		return "pending"
	}
}

// convertProtoTodos converts a proto todo map to a slice of TUI domain
// TodoItems. Returns nil for empty or nil maps.
func convertProtoTodos(todos map[string]*agentexecutionv1.TodoItem) []executiontui.TodoItem {
	if len(todos) == 0 {
		return nil
	}
	result := make([]executiontui.TodoItem, 0, len(todos))
	for _, item := range todos {
		result = append(result, executiontui.TodoItem{
			ID:      item.GetId(),
			Content: item.GetContent(),
			Status:  mapTodoStatus(item.GetStatus()),
		})
	}
	return result
}

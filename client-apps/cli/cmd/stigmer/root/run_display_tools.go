package root

import (
	"fmt"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// displayToolCalls renders structured tool call information from an AI message.
//
// Each tool call is printed as a single line with a category-aware icon, the tool
// name, and the most relevant argument. This replaces the old generic format:
//
//	Old: 🔧 Tool: read(path='main.go') -> 1164 chars
//	New:   📖 Read: main.go (1164 chars)
func displayToolCalls(toolCalls []*agentexecutionv1.ToolCall) {
	for _, tc := range toolCalls {
		info := convertToolCall(tc)
		fmt.Println(toolrender.Render(info))
	}
	if len(toolCalls) > 0 {
		fmt.Println()
		flushStdout()
	}
}

// convertToolCall transforms a proto ToolCall into a toolrender.ToolCallInfo.
//
// This is the bridge between the proto types and the domain-agnostic renderer.
// It extracts args via AsMap(), computes duration from timestamps, and maps
// the proto status enum to a human-readable string.
func convertToolCall(tc *agentexecutionv1.ToolCall) toolrender.ToolCallInfo {
	info := toolrender.ToolCallInfo{
		ID:              tc.Id,
		Name:            tc.Name,
		Status:          mapToolCallStatus(tc.Status),
		Result:          tc.Result,
		Error:           tc.Error,
		IsStreaming:     tc.IsStreaming,
		StreamingSource: mapStreamingSource(tc.StreamingSource),
		ServerName:      extractMcpServerSlug(tc),
	}

	// Convert proto Struct args to map
	if tc.Args != nil {
		info.Args = tc.Args.AsMap()
	}

	// Compute duration from timestamps when both are available
	info.Duration = computeToolCallDuration(tc.StartedAt, tc.CompletedAt)

	return info
}

// mapStreamingSource converts a proto ToolCallStreamingSource to a display string.
// Returns "input", "output", or "" (for UNSPECIFIED / unknown).
func mapStreamingSource(src agentexecutionv1.ToolCallStreamingSource) string {
	switch src {
	case agentexecutionv1.ToolCallStreamingSource_TOOL_CALL_STREAMING_SOURCE_INPUT:
		return "input"
	case agentexecutionv1.ToolCallStreamingSource_TOOL_CALL_STREAMING_SOURCE_OUTPUT:
		return "output"
	default:
		return ""
	}
}

// extractMcpServerSlug returns the MCP server slug from a ToolCall proto.
// Empty for built-in sandbox tools; populated by the worker when the tool
// originates from an MCP server.
func extractMcpServerSlug(tc *agentexecutionv1.ToolCall) string {
	return tc.GetMcpServerSlug()
}

// mapToolCallStatus converts a proto ToolCallStatus to a display string.
func mapToolCallStatus(status agentexecutionv1.ToolCallStatus) string {
	switch status {
	case agentexecutionv1.ToolCallStatus_TOOL_CALL_PENDING:
		return "pending"
	case agentexecutionv1.ToolCallStatus_TOOL_CALL_RUNNING:
		return "running"
	case agentexecutionv1.ToolCallStatus_TOOL_CALL_COMPLETED:
		return "completed"
	case agentexecutionv1.ToolCallStatus_TOOL_CALL_FAILED:
		return "failed"
	case agentexecutionv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL:
		return "waiting_approval"
	case agentexecutionv1.ToolCallStatus_TOOL_CALL_SKIPPED:
		return "skipped"
	default:
		return "unknown"
	}
}

// computeToolCallDuration calculates the elapsed time from ISO 8601 timestamps.
// Returns zero if either timestamp is empty or unparseable.
func computeToolCallDuration(startedAt, completedAt string) time.Duration {
	if startedAt == "" || completedAt == "" {
		return 0
	}

	start, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		return 0
	}

	end, err := time.Parse(time.RFC3339, completedAt)
	if err != nil {
		return 0
	}

	d := end.Sub(start)
	if d < 0 {
		return 0
	}

	return d
}

// spinnerLabelForAgentPhase returns a human-readable label for the spinner
// based on the current agent execution phase.
func spinnerLabelForAgentPhase(phase agentexecutionv1.ExecutionPhase) string {
	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_PENDING:
		return "Waiting for agent..."
	case agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS:
		return "Agent is working..."
	case agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL:
		return "Waiting for approval..."
	default:
		return "Processing..."
	}
}

// spinnerLabelForWorkflowPhase returns a human-readable label for the spinner
// based on the current workflow execution phase.
func spinnerLabelForWorkflowPhase(phase workflowexecutionv1.ExecutionPhase) string {
	switch phase {
	case workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING:
		return "Waiting for workflow..."
	case workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS:
		return "Workflow running..."
	default:
		return "Processing..."
	}
}

// isTerminalAgentPhase checks if agent execution phase is terminal.
func isTerminalAgentPhase(phase agentexecutionv1.ExecutionPhase) bool {
	return phase == agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED ||
		phase == agentexecutionv1.ExecutionPhase_EXECUTION_FAILED ||
		phase == agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED ||
		phase == agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED
}

// isTerminalWorkflowPhase checks if workflow execution phase is terminal.
func isTerminalWorkflowPhase(phase workflowexecutionv1.ExecutionPhase) bool {
	return phase == workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED ||
		phase == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED ||
		phase == workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED ||
		phase == workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED
}

package root

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/panel"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowexecution/v1"
)

// maxPanelWidth caps panel width to maintain readability on wide terminals.
// Panels wider than 100 columns become hard to scan visually.
const maxPanelWidth = 100

// summaryPanelWidth returns the panel width to use for summary and approval panels.
// It uses the terminal width but caps at maxPanelWidth.
func summaryPanelWidth() int {
	w := display.GetTerminalWidth()
	if w > maxPanelWidth {
		return maxPanelWidth
	}
	return w
}

// displayAgentExecutionComplete renders the final agent execution summary as
// a styled panel. The panel style reflects the execution outcome:
//   - Completed: green success panel
//   - Failed: red error panel with error message
//   - Cancelled/Terminated: yellow warning panel
func displayAgentExecutionComplete(execution *agentexecutionv1.AgentExecution) {
	title, style := agentSummaryTitleAndStyle(execution.Status.Phase)
	content := buildAgentSummaryContent(execution)

	fmt.Println()
	fmt.Println(panel.Render(content, panel.Options{
		Title: title,
		Style: style,
		Width: summaryPanelWidth(),
	}))
	fmt.Println()
	flushStdout()
}

// agentSummaryTitleAndStyle returns the panel title and style for an agent
// execution based on its terminal phase.
//
// Each terminal phase has an explicit case. The default is a true catch-all
// for unexpected phases rather than incorrectly labeling running executions
// as terminated.
func agentSummaryTitleAndStyle(phase agentexecutionv1.ExecutionPhase) (string, panel.PanelStyle) {
	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		return "EXECUTION COMPLETE", panel.StyleSuccess
	case agentexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		return "EXECUTION FAILED", panel.StyleError
	case agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		return "EXECUTION CANCELLED", panel.StyleWarning
	case agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED:
		return "EXECUTION TERMINATED", panel.StyleWarning
	default:
		return "EXECUTION STATUS UNKNOWN", panel.StyleDefault
	}
}

// buildAgentSummaryContent assembles the labeled statistics displayed inside the
// agent completion panel. For failures, the error message is shown first.
func buildAgentSummaryContent(execution *agentexecutionv1.AgentExecution) string {
	var sections []string

	// Error message (failures only)
	if execution.Status.Phase == agentexecutionv1.ExecutionPhase_EXECUTION_FAILED {
		if errorMsg := resolveFailureError(execution); errorMsg != "" {
			sections = append(sections, fmt.Sprintf("Error: %s", errorMsg))
			sections = append(sections, "")
		}
	}

	// Duration
	if d := parseDuration(execution.Status.StartedAt, execution.Status.CompletedAt); d > 0 {
		sections = append(sections, fmt.Sprintf("Duration:    %s", d.Round(time.Second)))
	}

	// Stats
	allToolCalls := collectToolCallsFromMessages(execution.Status.GetMessages())
	sections = append(sections, fmt.Sprintf("Messages:    %d", len(execution.Status.Messages)))
	sections = append(sections, fmt.Sprintf("Tool calls:  %d", len(allToolCalls)))

	// Tool breakdown (e.g., "read x3, execute x2, write x1")
	if breakdown := formatToolCallBreakdown(allToolCalls); breakdown != "" {
		sections = append(sections, fmt.Sprintf("             %s", breakdown))
	}

	// Approval status
	if hadApprovalWait(allToolCalls) {
		sections = append(sections, "Approval:    requested")
	}

	// Model, tokens, and cost (computed from per-message llm_metrics)
	if usage := computeExecutionUsage(execution); usage != nil {
		if label := formatModelLabel(usage); label != "" {
			sections = append(sections, fmt.Sprintf("Model:       %s", label))
		}
		if usage.TotalTokens > 0 {
			sections = append(sections, fmt.Sprintf("Tokens:      %s (%s in, %s out)",
				formatTokenCount(usage.TotalTokens),
				formatTokenCount(usage.PromptTokens),
				formatTokenCount(usage.CompletionTokens)))
		}
		if costLine := formatCostLine(usage); costLine != "" {
			sections = append(sections, fmt.Sprintf("Cost:        %s", costLine))
		}
	}

	// Context utilization
	if ctx := execution.Status.GetContextInfo(); ctx != nil && ctx.ContextWindowLimit > 0 {
		utilPct := float64(ctx.CurrentTokenCount) / float64(ctx.ContextWindowLimit) * 100
		sections = append(sections, fmt.Sprintf("Context:     %s / %s (%.0f%%)",
			formatTokenCount(ctx.CurrentTokenCount),
			formatTokenCount(ctx.ContextWindowLimit),
			utilPct))
	}

	// Artifacts
	if len(execution.Status.Artifacts) > 0 {
		sections = append(sections, fmt.Sprintf("Artifacts:   %d", len(execution.Status.Artifacts)))
	}

	return strings.Join(sections, "\n")
}

// formatToolCallBreakdown returns a compact summary of tool usage, e.g., "read x3, execute x2".
func formatToolCallBreakdown(toolCalls []*agentexecutionv1.ToolCall) string {
	if len(toolCalls) == 0 {
		return ""
	}

	// Count tool calls by name
	counts := make(map[string]int)
	for _, tc := range toolCalls {
		counts[tc.Name]++
	}

	// Build sorted list for consistent output
	var parts []string
	for name, count := range counts {
		parts = append(parts, fmt.Sprintf("%s x%d", name, count))
	}

	// Sort alphabetically for consistent output
	if len(parts) > 1 {
		// Simple bubble sort for small lists
		for i := 0; i < len(parts)-1; i++ {
			for j := i + 1; j < len(parts); j++ {
				if parts[i] > parts[j] {
					parts[i], parts[j] = parts[j], parts[i]
				}
			}
		}
	}

	// Limit to 4 tools to keep summary compact
	if len(parts) > 4 {
		remaining := len(parts) - 3
		parts = append(parts[:3], fmt.Sprintf("+%d more", remaining))
	}

	return strings.Join(parts, ", ")
}

// hadApprovalWait checks if any tool call required approval during execution.
func hadApprovalWait(toolCalls []*agentexecutionv1.ToolCall) bool {
	for _, tc := range toolCalls {
		if tc.RequiresApproval {
			return true
		}
	}
	return false
}

// formatTokenCount returns a human-readable token count (e.g., "12.5K", "1.2M").
func formatTokenCount(count int32) string {
	if count < 1000 {
		return fmt.Sprintf("%d", count)
	}
	if count < 1000000 {
		return fmt.Sprintf("%.1fK", float64(count)/1000)
	}
	return fmt.Sprintf("%.1fM", float64(count)/1000000)
}

// displayWorkflowExecutionComplete renders the final workflow execution summary
// as a styled panel. Includes a task breakdown showing completed, failed, and
// skipped counts.
func displayWorkflowExecutionComplete(execution *workflowexecutionv1.WorkflowExecution) {
	title, style := workflowSummaryTitleAndStyle(execution.Status.Phase)
	content := buildWorkflowSummaryContent(execution)

	fmt.Println()
	fmt.Println(panel.Render(content, panel.Options{
		Title: title,
		Style: style,
		Width: summaryPanelWidth(),
	}))
	fmt.Println()
	flushStdout()
}

// workflowSummaryTitleAndStyle returns the panel title and style for a workflow
// execution based on its terminal phase.
func workflowSummaryTitleAndStyle(phase workflowexecutionv1.ExecutionPhase) (string, panel.PanelStyle) {
	switch phase {
	case workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		return "WORKFLOW COMPLETE", panel.StyleSuccess
	case workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		return "WORKFLOW FAILED", panel.StyleError
	case workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		return "WORKFLOW CANCELLED", panel.StyleWarning
	default:
		return "WORKFLOW TERMINATED", panel.StyleWarning
	}
}

// buildWorkflowSummaryContent assembles the labeled statistics displayed inside
// the workflow completion panel. For failures, the error message is shown first.
// Task counts are broken down by status.
func buildWorkflowSummaryContent(execution *workflowexecutionv1.WorkflowExecution) string {
	var sections []string

	// Error message (failures only)
	if execution.Status.Phase == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED &&
		execution.Status.Error != "" {
		sections = append(sections, fmt.Sprintf("Error: %s", execution.Status.Error))
		sections = append(sections, "")
	}

	// Duration
	if d := parseDuration(execution.Status.StartedAt, execution.Status.CompletedAt); d > 0 {
		sections = append(sections, fmt.Sprintf("Duration:  %s", d.Round(time.Second)))
	}

	// Task breakdown
	completed, failed, skipped := countWorkflowTasks(execution.Status.Tasks)
	total := len(execution.Status.Tasks)

	sections = append(sections, fmt.Sprintf("Tasks:     %d total", total))
	if completed > 0 {
		sections = append(sections, fmt.Sprintf("           %d completed", completed))
	}
	if failed > 0 {
		sections = append(sections, fmt.Sprintf("           %d failed", failed))
	}
	if skipped > 0 {
		sections = append(sections, fmt.Sprintf("           %d skipped", skipped))
	}

	return strings.Join(sections, "\n")
}

// countWorkflowTasks tallies completed, failed, and skipped tasks.
func countWorkflowTasks(tasks []*workflowexecutionv1.WorkflowTask) (completed, failed, skipped int) {
	for _, task := range tasks {
		switch task.Status {
		case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED:
			completed++
		case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED:
			failed++
		case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_SKIPPED:
			skipped++
		}
	}
	return
}

// resolveFailureError returns the error message for a failed agent execution.
//
// It checks three sources in priority order:
//  1. Status.Error — the canonical error field (set by agent-runner or workflow)
//  2. The last system message — Python error handlers append "❌ Error: ..." messages
//  3. The first failed tool call's Error field — useful for REJECT-path failures
//
// Returns empty string only when no error information is available at all,
// in which case a generic fallback message is used by the caller.
func resolveFailureError(execution *agentexecutionv1.AgentExecution) string {
	// Primary: canonical error field
	if execution.Status.Error != "" {
		return execution.Status.Error
	}

	// Fallback 1: last system message (error handlers append system messages
	// with error details before setting the phase to FAILED)
	for i := len(execution.Status.Messages) - 1; i >= 0; i-- {
		msg := execution.Status.Messages[i]
		if msg.Type == agentexecutionv1.MessageType_MESSAGE_SYSTEM && msg.Content != "" {
			return msg.Content
		}
	}

	// Fallback 2: first failed tool call's error
	for _, tc := range collectToolCallsFromMessages(execution.Status.GetMessages()) {
		if tc.Status == agentexecutionv1.ToolCallStatus_TOOL_CALL_FAILED && tc.Error != "" {
			return tc.Error
		}
	}

	// Last resort: generic message directing user to logs
	return "Execution failed (error details unavailable — check execution logs)"
}

// displaySessionExitLine prints a compact summary after streaming ends for a
// session-based command. The status line uses climsg for colored output on
// stderr, followed by a copy-pasteable resume command.
func displaySessionExitLine(sessionID string, exec *agentexecutionv1.AgentExecution) {
	fmt.Fprintln(os.Stderr)
	phase := exec.GetStatus().GetPhase()
	duration := parseDuration(exec.GetStatus().GetStartedAt(), exec.GetStatus().GetCompletedAt())
	var cost float64
	if u := computeExecutionUsage(exec); u != nil {
		cost = u.EstimatedCostUsd
	}

	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		if duration > 0 && cost > 0 {
			climsg.Success("Completed (%s · %s)", duration.Round(time.Second), formatCost(cost))
		} else if duration > 0 {
			climsg.Success("Completed (%s)", duration.Round(time.Second))
		} else {
			climsg.Success("Completed")
		}
	case agentexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		climsg.Error("Failed: %s", resolveFailureError(exec))
	case agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		climsg.Warning("Cancelled")
	case agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED:
		climsg.Warning("Stopped: %s", resolveFailureError(exec))
	default:
		climsg.Warning("Exited (%s)", mapPhaseToString(phase))
	}

	verb := sessionResumeVerb(phase)
	fmt.Fprintf(os.Stderr, "\n  %s  stigmer resume %s\n", verb, sessionID)
}

// sessionResumeVerb returns a human-friendly label for the resume command
// based on the execution phase.
func sessionResumeVerb(phase agentexecutionv1.ExecutionPhase) string {
	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		return "To continue:"
	case agentexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		return "To retry:   "
	default:
		return "To resume:  "
	}
}

// displaySessionDetachLine prints a single-line detach notice with
// a copy-paste-ready re-attach command.
func displaySessionDetachLine(sessionID string) {
	fmt.Println()
	fmt.Printf("Detached from %s (still running) — stigmer resume %s to re-attach\n", sessionID, sessionID)
	flushStdout()
}

// parseDuration calculates elapsed time between two RFC3339 timestamps.
// Returns zero if either timestamp is empty or unparseable.
func parseDuration(startedAt, completedAt string) time.Duration {
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

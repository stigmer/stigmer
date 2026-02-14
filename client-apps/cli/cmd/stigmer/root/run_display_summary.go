package root

import (
	"fmt"
	"strings"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/panel"
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
func agentSummaryTitleAndStyle(phase agentexecutionv1.ExecutionPhase) (string, panel.PanelStyle) {
	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		return "EXECUTION COMPLETE", panel.StyleSuccess
	case agentexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		return "EXECUTION FAILED", panel.StyleError
	case agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		return "EXECUTION CANCELLED", panel.StyleWarning
	default:
		return "EXECUTION TERMINATED", panel.StyleWarning
	}
}

// buildAgentSummaryContent assembles the labeled statistics displayed inside the
// agent completion panel. For failures, the error message is shown first.
func buildAgentSummaryContent(execution *agentexecutionv1.AgentExecution) string {
	var sections []string

	// Error message (failures only)
	if execution.Status.Phase == agentexecutionv1.ExecutionPhase_EXECUTION_FAILED &&
		execution.Status.Error != "" {
		sections = append(sections, fmt.Sprintf("Error: %s", execution.Status.Error))
		sections = append(sections, "")
	}

	// Duration
	if d := parseDuration(execution.Status.StartedAt, execution.Status.CompletedAt); d > 0 {
		sections = append(sections, fmt.Sprintf("Duration:   %s", d.Round(time.Second)))
	}

	// Stats
	sections = append(sections, fmt.Sprintf("Messages:   %d", len(execution.Status.Messages)))
	sections = append(sections, fmt.Sprintf("Tool calls: %d", len(execution.Status.ToolCalls)))

	// Artifacts
	if len(execution.Status.Artifacts) > 0 {
		sections = append(sections, fmt.Sprintf("Artifacts:  %d", len(execution.Status.Artifacts)))
	}

	return strings.Join(sections, "\n")
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

package root

import (
	"fmt"
	"os"
	"regexp"
	"strings"

	workflowexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

// flushStdout ensures output is immediately visible, especially important
// when stdout is not a TTY (e.g., running from shell scripts).
func flushStdout() {
	_ = os.Stdout.Sync()
}

// displayWorkflowPhaseChange shows when workflow execution phase changes
func displayWorkflowPhaseChange(phase workflowexecutionv1.ExecutionPhase) {
	switch phase {
	case workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING:
		climsg.Info("Execution pending...")
	case workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS:
		climsg.Success("Execution started")
	case workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		climsg.Success("Execution completed")
	case workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		climsg.Error("Execution failed")
	case workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		climsg.Warning("Execution cancelled")
	}
	fmt.Println()
	flushStdout()
}

// displayWorkflowTask displays a workflow task's status
func displayWorkflowTask(task *workflowexecutionv1.WorkflowTask) {
	var badge string
	var statusText string

	switch task.Status {
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_PENDING:
		badge = "..."
		statusText = "Pending"
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_IN_PROGRESS:
		badge = "..."
		statusText = "Running"
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED:
		badge = "✓"
		statusText = "Completed"
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED:
		badge = "✗"
		statusText = "Failed"
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_SKIPPED:
		badge = "~"
		statusText = "Skipped"
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_WAITING_APPROVAL:
		badge = "||"
		statusText = "Awaiting Approval"
	}

	fmt.Printf("%s Task: %s [%s]\n", badge, task.TaskName, statusText)

	if task.Error != "" {
		fmt.Printf("   ✗ Error: %s\n", task.Error)
	}

	fmt.Println()
	flushStdout()
}

// ---------------------------------------------------------------------------
// Error content sanitization
// ---------------------------------------------------------------------------

// rawAPIErrorPattern matches raw HTTP/API error responses that leak internal
// details. Examples:
//
//	"Error code: 400 - {'type': 'error', ...}"
//	"Error code: 500 - {\"error\": ...}"
var rawAPIErrorPattern = regexp.MustCompile(`Error code: \d+ - [{'\"]`)

// rawExceptionPatterns lists substrings that indicate raw exception or API
// internals that should not be shown verbatim to end users.
var rawExceptionPatterns = []string{
	"invalid_request_error",
	"request_id",
	"'type': 'error'",
	`"type": "error"`,
}

// sanitizeSystemContent rewrites raw API/exception error messages into clean
// user-facing text. Non-error system messages pass through unchanged.
//
// The heuristic: if the content contains a raw HTTP error code pattern or
// known exception internals, replace the raw detail with a concise summary.
// The full error is always available via `stigmer get execution <id>`.
func sanitizeSystemContent(content string) string {
	if !isRawErrorContent(content) {
		return content
	}

	// Try to extract a human-readable portion before the raw API dump.
	// The agent runner often prefixes errors: "❌ Error: Execution failed: Error code: 400 - ..."
	// We want to keep "Execution failed" but drop everything from the raw dump onward.
	if idx := strings.Index(content, "Error code:"); idx > 0 {
		prefix := strings.TrimSpace(content[:idx])
		// Strip trailing colon or dash left after trimming.
		prefix = strings.TrimRight(prefix, ":- ")
		if prefix != "" {
			return prefix + " (internal error — check execution logs for details)"
		}
	}

	// Fallback: entire content is raw error — replace wholesale.
	return "Agent execution encountered an internal error. Check execution logs for details."
}

// isRawErrorContent returns true if content looks like a raw API error response
// rather than a curated user-facing message.
func isRawErrorContent(content string) bool {
	if rawAPIErrorPattern.MatchString(content) {
		return true
	}
	for _, pattern := range rawExceptionPatterns {
		if strings.Contains(content, pattern) {
			return true
		}
	}
	return false
}

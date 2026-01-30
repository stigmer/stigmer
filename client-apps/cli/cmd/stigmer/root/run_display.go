package root

import (
	"fmt"
	"strings"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
)

// displayAgentPhaseChange shows when agent execution phase changes
func displayAgentPhaseChange(phase agentexecutionv1.ExecutionPhase) {
	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_PENDING:
		cliprint.PrintInfo("⏳ Execution pending...")
	case agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS:
		cliprint.PrintSuccess("▶️  Execution started")
	case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		cliprint.PrintSuccess("✅ Execution completed")
	case agentexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		cliprint.PrintError("❌ Execution failed")
	case agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		cliprint.PrintWarning("⚠️  Execution cancelled")
	case agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL:
		cliprint.PrintWarning("⏸️  Approval required")
	}
	fmt.Println()
}

// displayAgentMessage displays a single agent message
func displayAgentMessage(msg *agentexecutionv1.AgentMessage) {
	var icon string
	var label string

	switch msg.Type {
	case agentexecutionv1.MessageType_MESSAGE_HUMAN:
		icon = "💬"
		label = "You"
	case agentexecutionv1.MessageType_MESSAGE_AI:
		icon = "🤖"
		label = "Agent"
	case agentexecutionv1.MessageType_MESSAGE_TOOL:
		icon = "🔧"
		label = "Tool"
	case agentexecutionv1.MessageType_MESSAGE_SYSTEM:
		icon = "ℹ️"
		label = "System"
	}

	fmt.Printf("%s %s: %s\n\n", icon, label, msg.Content)
}

// displayWorkflowPhaseChange shows when workflow execution phase changes
func displayWorkflowPhaseChange(phase workflowexecutionv1.ExecutionPhase) {
	switch phase {
	case workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING:
		cliprint.PrintInfo("⏳ Execution pending...")
	case workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS:
		cliprint.PrintSuccess("▶️  Execution started")
	case workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		cliprint.PrintSuccess("✅ Execution completed")
	case workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		cliprint.PrintError("❌ Execution failed")
	case workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		cliprint.PrintWarning("⚠️  Execution cancelled")
	}
	fmt.Println()
}

// displayWorkflowTask displays a workflow task's status
func displayWorkflowTask(task *workflowexecutionv1.WorkflowTask) {
	var icon string
	var statusText string

	switch task.Status {
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_PENDING:
		icon = "⏳"
		statusText = "Pending"
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_IN_PROGRESS:
		icon = "⚙️"
		statusText = "Running"
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED:
		icon = "✓"
		statusText = "Completed"
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED:
		icon = "✗"
		statusText = "Failed"
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_SKIPPED:
		icon = "⊘"
		statusText = "Skipped"
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_WAITING_APPROVAL:
		icon = "⏸"
		statusText = "Awaiting Approval"
	}

	fmt.Printf("%s Task: %s [%s]\n", icon, task.TaskName, statusText)

	// Show error if failed
	if task.Error != "" {
		fmt.Printf("   ✗ Error: %s\n", task.Error)
	}

	fmt.Println()
}

// displayAgentExecutionComplete shows final agent execution summary
func displayAgentExecutionComplete(execution *agentexecutionv1.AgentExecution) {
	fmt.Println()
	fmt.Println(strings.Repeat("─", 80))

	switch execution.Status.Phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		cliprint.PrintSuccess("Done!")
	case agentexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		cliprint.PrintError("Execution failed")
		if execution.Status.Error != "" {
			cliprint.PrintError("Error: %s", execution.Status.Error)
		}
	case agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		cliprint.PrintWarning("Execution cancelled")
	}

	// Display timing information
	if execution.Status.StartedAt != "" && execution.Status.CompletedAt != "" {
		startTime, _ := time.Parse(time.RFC3339, execution.Status.StartedAt)
		endTime, _ := time.Parse(time.RFC3339, execution.Status.CompletedAt)
		duration := endTime.Sub(startTime)
		cliprint.PrintSuccess("Duration: %s", duration.Round(time.Second))
	}

	// Display summary stats
	cliprint.PrintSuccess("Total messages: %d", len(execution.Status.Messages))
	cliprint.PrintSuccess("Tool calls: %d", len(execution.Status.ToolCalls))

	fmt.Println(strings.Repeat("─", 80))
	fmt.Println()
}

// displayWorkflowExecutionComplete shows final workflow execution summary
func displayWorkflowExecutionComplete(execution *workflowexecutionv1.WorkflowExecution) {
	fmt.Println()
	fmt.Println(strings.Repeat("─", 80))

	switch execution.Status.Phase {
	case workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		cliprint.PrintSuccess("Done!")
	case workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		cliprint.PrintError("Workflow execution failed")
		if execution.Status.Error != "" {
			cliprint.PrintError("Error: %s", execution.Status.Error)
		}
	case workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		cliprint.PrintWarning("Workflow execution cancelled")
	}

	// Display timing information
	if execution.Status.StartedAt != "" && execution.Status.CompletedAt != "" {
		startTime, _ := time.Parse(time.RFC3339, execution.Status.StartedAt)
		endTime, _ := time.Parse(time.RFC3339, execution.Status.CompletedAt)
		duration := endTime.Sub(startTime)
		cliprint.PrintSuccess("Duration: %s", duration.Round(time.Second))
	}

	// Display summary stats
	totalTasks := len(execution.Status.Tasks)
	completedTasks := 0
	failedTasks := 0
	skippedTasks := 0

	for _, task := range execution.Status.Tasks {
		switch task.Status {
		case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED:
			completedTasks++
		case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED:
			failedTasks++
		case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_SKIPPED:
			skippedTasks++
		}
	}

	cliprint.PrintSuccess("Total tasks: %d", totalTasks)
	cliprint.PrintSuccess("Completed: %d", completedTasks)
	if failedTasks > 0 {
		cliprint.PrintError("Failed: %d", failedTasks)
	}
	if skippedTasks > 0 {
		cliprint.PrintInfo("Skipped: %d", skippedTasks)
	}

	fmt.Println(strings.Repeat("─", 80))
	fmt.Println()
}

// isTerminalAgentPhase checks if agent execution phase is terminal
func isTerminalAgentPhase(phase agentexecutionv1.ExecutionPhase) bool {
	return phase == agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED ||
		phase == agentexecutionv1.ExecutionPhase_EXECUTION_FAILED ||
		phase == agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED
}

// isTerminalWorkflowPhase checks if workflow execution phase is terminal
func isTerminalWorkflowPhase(phase workflowexecutionv1.ExecutionPhase) bool {
	return phase == workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED ||
		phase == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED ||
		phase == workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED
}

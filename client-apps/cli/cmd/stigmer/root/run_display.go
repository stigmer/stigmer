package root

import (
	"fmt"
	"os"

	"github.com/charmbracelet/lipgloss"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// flushStdout ensures output is immediately visible, especially important
// when stdout is not a TTY (e.g., running from shell scripts).
func flushStdout() {
	_ = os.Stdout.Sync()
}

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
	flushStdout()
}

// systemMsgStyle renders system messages with dimmed styling to create visual
// hierarchy — system messages are informational, not primary content.
var systemMsgStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))

// displayAgentMessage renders a single agent message with type-aware formatting.
//
// Each message type gets distinct visual treatment:
//   - HUMAN: user's own input, shown as-is
//   - AI: agent response with optional structured tool call list
//   - TOOL: concise result summary instead of raw content dump
//   - SYSTEM: dimmed to distinguish from primary conversation flow
func displayAgentMessage(msg *agentexecutionv1.AgentMessage) {
	switch msg.Type {
	case agentexecutionv1.MessageType_MESSAGE_HUMAN:
		displayHumanMessage(msg)
	case agentexecutionv1.MessageType_MESSAGE_AI:
		displayAIMessage(msg)
	case agentexecutionv1.MessageType_MESSAGE_TOOL:
		displayToolMessage(msg)
	case agentexecutionv1.MessageType_MESSAGE_SYSTEM:
		displaySystemMessage(msg)
	default:
		// Fallback for unknown message types
		fmt.Printf("❓ Unknown: %s\n\n", msg.Content)
		flushStdout()
	}
}

// displayHumanMessage renders the user's input message.
func displayHumanMessage(msg *agentexecutionv1.AgentMessage) {
	fmt.Printf("💬 You: %s\n\n", msg.Content)
	flushStdout()
}

// displayAIMessage renders an agent response. If the AI message initiated tool
// calls, each is rendered below the text using structured category-aware display.
func displayAIMessage(msg *agentexecutionv1.AgentMessage) {
	if msg.Content != "" {
		fmt.Printf("🤖 Agent: %s\n\n", msg.Content)
	}

	if len(msg.ToolCalls) > 0 {
		displayToolCalls(msg.ToolCalls)
	} else if msg.Content != "" {
		flushStdout()
	}
}

// displayToolMessage renders a tool result as a concise summary line.
// Instead of dumping raw content, shows the result size.
func displayToolMessage(msg *agentexecutionv1.AgentMessage) {
	fmt.Println(toolrender.RenderResult(msg.Content))
	fmt.Println()
	flushStdout()
}

// displaySystemMessage renders system messages with dimmed styling.
func displaySystemMessage(msg *agentexecutionv1.AgentMessage) {
	fmt.Printf("%s\n\n", systemMsgStyle.Render("ℹ️  "+msg.Content))
	flushStdout()
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
	flushStdout()
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
	flushStdout()
}

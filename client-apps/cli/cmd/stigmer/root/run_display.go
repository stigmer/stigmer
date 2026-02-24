package root

import (
	"fmt"
	"os"

	"github.com/charmbracelet/lipgloss"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/mdrender"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// flushStdout ensures output is immediately visible, especially important
// when stdout is not a TTY (e.g., running from shell scripts).
func flushStdout() {
	_ = os.Stdout.Sync()
}

// displayAgentPhaseChange shows when agent execution phase changes.
//
// previousPhase provides context for resume-aware messaging:
//   - WAITING_FOR_APPROVAL is suppressed entirely — the approval panel and
//     interactive prompt are the user-facing signal; a redundant status line
//     adds noise without information.
//   - Transition from WAITING_FOR_APPROVAL to IN_PROGRESS shows "Resumed after
//     approval" instead of the generic "Execution started", so the user
//     understands this is a continuation, not a fresh start.
func displayAgentPhaseChange(phase, previousPhase agentexecutionv1.ExecutionPhase) {
	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_PENDING:
		cliprint.PrintInfo("⏳ Execution pending...")
	case agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS:
		if previousPhase == agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL {
			// Returning from an approval pause — show "resumed" instead of
			// the misleading "started" which implies a fresh execution.
			cliprint.PrintSuccess("▶️  Resumed after approval")
		} else {
			cliprint.PrintSuccess("▶️  Execution started")
		}
	case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		cliprint.PrintSuccess("✅ Execution completed")
	case agentexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		cliprint.PrintError("❌ Execution failed")
	case agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		cliprint.PrintWarning("⚠️  Execution cancelled")
	case agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL:
		// Suppressed: The approval panel ("APPROVAL REQUIRED" box) and the
		// interactive prompt are the user-facing signal for this state.
		// Printing an additional status line here is redundant noise.
		return
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

// displayAIMessage renders an agent response. Content containing markdown is
// rendered to ANSI-styled terminal text. If the AI message initiated tool
// calls, each is rendered below the text using structured category-aware display.
func displayAIMessage(msg *agentexecutionv1.AgentMessage) {
	if msg.Content != "" {
		fmt.Printf("%s\n\n", formatNonTUIAIText(msg.Content))
	}

	if len(msg.ToolCalls) > 0 {
		displayToolCalls(msg.ToolCalls)
	} else if msg.Content != "" {
		flushStdout()
	}
}

// formatNonTUIAIText renders the text portion of an AI message for the non-TUI
// display path. Markdown content is rendered with ANSI styling using the current
// terminal width. Plain text uses the compact inline prefix.
func formatNonTUIAIText(content string) string {
	if !mdrender.HasMarkdown(content) {
		return fmt.Sprintf("🤖 Agent: %s", content)
	}
	rendered := mdrender.Render(content, display.GetTerminalWidth())
	return fmt.Sprintf("🤖 Agent:\n%s", rendered)
}

// displayToolMessage renders a tool result as a concise summary line.
// Instead of dumping raw content, shows the result size.
func displayToolMessage(msg *agentexecutionv1.AgentMessage) {
	fmt.Println(toolrender.RenderResult(msg.Content))
	fmt.Println()
	flushStdout()
}

// displaySystemMessage renders system messages with dimmed styling.
// Raw API errors are sanitized to user-friendly text before display.
func displaySystemMessage(msg *agentexecutionv1.AgentMessage) {
	content := sanitizeSystemContent(msg.Content)
	fmt.Printf("%s\n\n", systemMsgStyle.Render("ℹ️  "+content))
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

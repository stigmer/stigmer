package root

import (
	"fmt"
	"os"

	"charm.land/lipgloss/v2"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
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
		climsg.Info("Execution pending...")
	case agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS:
		if previousPhase == agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL {
			climsg.Success("Resumed after approval")
		} else {
			climsg.Success("Execution started")
		}
	case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		climsg.Success("Execution completed")
	case agentexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		climsg.Error("Execution failed")
	case agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED:
		climsg.Warning("Execution stopped")
	case agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		climsg.Warning("Execution cancelled")
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

// humanMsgStyle renders user messages with a highlighted background block,
// making them visually distinct from AI responses and status output. The
// subtle dark-gray background with bright-white foreground matches the
// Claude Code-style inverted treatment for user input.
var humanMsgStyle = lipgloss.NewStyle().
	Background(lipgloss.Color("236")).
	Foreground(lipgloss.Color("15")).
	Padding(0, 1)

// promptStyle renders the follow-up input prompt marker (">") in bold blue,
// matching the session header panel color for visual continuity.
var promptStyle = lipgloss.NewStyle().
	Bold(true).
	Foreground(lipgloss.Color("12"))

// followUpHintStyle renders the hint line below the follow-up prompt in
// dim italic, matching the approval menu hint styling for consistency.
var followUpHintStyle = lipgloss.NewStyle().
	Foreground(lipgloss.Color("8")).
	Italic(true)

// expandHintStyle renders the "(ctrl+o to expand)" hint appended to compact
// tool lines. Uses the same dim color as toolrender.dimStyle so the hint
// blends with existing parenthetical metadata like "(43 lines)".
var expandHintStyle = lipgloss.NewStyle().
	Foreground(lipgloss.Color("8"))

// formatHumanMessage formats a user message with highlighted styling for
// display in both streaming and non-streaming rendering paths.
func formatHumanMessage(content string) string {
	return humanMsgStyle.Render(content)
}

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
		fmt.Printf("Unknown: %s\n\n", msg.Content)
		flushStdout()
	}
}

// displayHumanMessage renders the user's input message with highlighted styling.
func displayHumanMessage(msg *agentexecutionv1.AgentMessage) {
	fmt.Printf("%s\n\n", formatHumanMessage(msg.Content))
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
		return content
	}
	return mdrender.Render(content, display.GetTerminalWidth())
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
	fmt.Printf("%s\n\n", systemMsgStyle.Render(content))
	flushStdout()
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

	// Show error if failed
	if task.Error != "" {
		fmt.Printf("   ✗ Error: %s\n", task.Error)
	}

	fmt.Println()
	flushStdout()
}

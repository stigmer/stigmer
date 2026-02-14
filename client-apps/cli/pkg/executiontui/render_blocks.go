package executiontui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// Styles for rendering content blocks. These mirror the styles used by the
// existing non-TUI renderer to maintain visual parity.
var (
	systemStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	phaseStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("6"))
)

// renderAIContent formats an AI message for display.
// When the message has both text and tool calls, they are joined with a blank line.
func renderAIContent(content string, toolCalls []toolrender.ToolCallInfo) string {
	var parts []string

	if content != "" {
		parts = append(parts, fmt.Sprintf("🤖 Agent: %s", content))
	}

	if len(toolCalls) > 0 {
		for _, tc := range toolCalls {
			parts = append(parts, toolrender.Render(tc))
		}
	} else if content == "" {
		// AI invoked tools without text — show activity indicator.
		parts = append(parts, systemStyle.Render("🤖 Agent is invoking tools..."))
	}

	return strings.Join(parts, "\n")
}

// renderStreamingAI formats a streaming AI message with a cursor indicator.
func renderStreamingAI(content string) string {
	if content == "" {
		return "🤖 Agent: ▍"
	}
	return fmt.Sprintf("🤖 Agent: %s▍", content)
}

// renderHumanContent formats a human message for display.
func renderHumanContent(content string) string {
	return fmt.Sprintf("💬 You: %s", content)
}

// renderToolResultPreview formats tool result blocks for the collapsed state.
// When structured ToolCalls are available, each is rendered with
// toolrender.Render (header + truncated preview). Otherwise, the fallback
// content preview is shown.
func renderToolResultPreview(content string, toolCalls []toolrender.ToolCallInfo) string {
	if len(toolCalls) > 0 {
		var lines []string
		for _, tc := range toolCalls {
			lines = append(lines, toolrender.Render(tc))
		}
		return strings.Join(lines, "\n")
	}

	return toolrender.RenderResultWithPreview(content)
}

// renderToolResultExpanded formats tool result blocks for the expanded state.
// When structured ToolCalls are available, each is rendered with
// toolrender.RenderExpanded (header + full result content). Otherwise, the
// raw content is shown in full.
func renderToolResultExpanded(content string, toolCalls []toolrender.ToolCallInfo) string {
	if len(toolCalls) > 0 {
		var lines []string
		for _, tc := range toolCalls {
			lines = append(lines, toolrender.RenderExpanded(tc))
		}
		return strings.Join(lines, "\n")
	}

	// Fallback: show the full content when no structured tool calls exist.
	if content == "" {
		return toolrender.RenderResultWithPreview(content)
	}
	return toolrender.RenderResultWithPreview(content) + "\n" + content
}

// renderSystemContent formats a system message with dimmed styling.
func renderSystemContent(content string) string {
	return systemStyle.Render("ℹ️  " + content)
}

// renderPhaseChange formats a phase change notification.
func renderPhaseChange(phase, previous string) string {
	text := phaseDisplayText(phase, previous)
	if text == "" {
		return ""
	}
	return phaseStyle.Render(text)
}

// phaseDisplayText returns the human-readable text for a phase transition.
// Returns empty string for phases that should be suppressed (e.g., waiting_for_approval).
func phaseDisplayText(phase, previous string) string {
	switch phase {
	case "pending":
		return "⏳ Execution pending..."
	case "in_progress":
		if previous == "waiting_for_approval" {
			return "▶️  Resumed after approval"
		}
		return "▶️  Execution started"
	case "completed":
		return "✅ Execution completed"
	case "failed":
		return "❌ Execution failed"
	case "cancelled":
		return "⚠️  Execution cancelled"
	case "terminated":
		return "⚠️  Execution terminated"
	case "waiting_for_approval":
		// Suppressed: the approval panel is the user-facing signal.
		return ""
	default:
		return fmt.Sprintf("Phase: %s", phase)
	}
}

// renderApprovalPrompt formats the approval request display shown in the viewport.
func renderApprovalPrompt(toolName, argsPreview, message string) string {
	var lines []string

	lines = append(lines, lipgloss.NewStyle().Bold(true).Render("⏸  APPROVAL REQUIRED"))
	lines = append(lines, "")

	if message != "" {
		lines = append(lines, fmt.Sprintf("   %s", message))
	}
	if toolName != "" {
		lines = append(lines, fmt.Sprintf("   Tool: %s", toolName))
	}
	if argsPreview != "" {
		lines = append(lines, fmt.Sprintf("   Args: %s", argsPreview))
	}

	lines = append(lines, "")
	lines = append(lines, lipgloss.NewStyle().Bold(true).Render(
		"   [a] Approve   [s] Skip   [r] Reject",
	))

	return strings.Join(lines, "\n")
}

// rebuildViewportContent concatenates all blocks into a single string for the
// viewport. Each block is separated by a blank line for readability.
//
// Expandable blocks receive visual indicators:
//   - ▶ suffix when collapsed (can be expanded)
//   - ▼ suffix when expanded (can be collapsed)
//   - ▸ prefix when the block has keyboard focus
//
// focusedIndex is the index into blocks of the currently focused expandable
// block, or -1 when no block is focused.
func rebuildViewportContent(blocks []contentBlock, focusedIndex int) string {
	if len(blocks) == 0 {
		return ""
	}

	var parts []string
	for i, b := range blocks {
		text := b.displayContent()
		if text == "" {
			continue
		}

		if b.expandable {
			text = decorateExpandableBlock(text, b.expanded, i == focusedIndex)
		}

		parts = append(parts, text)
	}
	return strings.Join(parts, "\n\n")
}

// decorateExpandableBlock adds focus and expand/collapse indicators to an
// expandable block's display text. The indicators are applied to the first
// line of the block content (the header line).
//
//   - focused + expanded:  "▸ <header> ▼"
//   - focused + collapsed: "▸ <header> ▶"
//   - unfocused + expanded:  "  <header> ▼"
//   - unfocused + collapsed: "  <header> ▶"
func decorateExpandableBlock(text string, expanded, focused bool) string {
	lines := strings.SplitN(text, "\n", 2)
	header := lines[0]

	// Expand/collapse indicator.
	if expanded {
		header += " ▼"
	} else {
		header += " ▶"
	}

	// Focus prefix.
	if focused {
		header = "▸ " + header
	} else {
		header = "  " + header
	}

	// Reassemble with the rest of the content (if any).
	if len(lines) > 1 {
		return header + "\n" + lines[1]
	}
	return header
}

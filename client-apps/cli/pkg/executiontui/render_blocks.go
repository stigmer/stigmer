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
	errorStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("1")).Bold(true)
	dimStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
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

// renderToolRunning formats a tool call in running state with a liveness indicator.
func renderToolRunning(tc toolrender.ToolCallInfo) string {
	return toolrender.RenderRunning(tc)
}

// renderToolWaitingApproval formats a tool call that is blocked waiting for
// user approval. Shows a pause indicator (⏸) before the full approval prompt
// arrives via ApprovalNeededEvent.
func renderToolWaitingApproval(tc toolrender.ToolCallInfo) string {
	return toolrender.RenderWaitingApproval(tc)
}

// renderToolFinalized replaces the running indicator (⏳) with a completion
// indicator (✓) for tools that were still in-progress when execution finished.
// This avoids leaving stale "in progress" visual cues in the final display.
func renderToolFinalized(runningContent string) string {
	return strings.Replace(runningContent, "⏳", "✓", 1)
}

// renderStreamingTool formats a tool call that is actively streaming output.
// Shows the tool header with a running indicator, followed by a gutter-bordered
// preview of the streaming content with a cursor indicator.
//
// Example:
//
//	📝 Write: agent-drafter/SKILL.md ⏳
//	     │ # Agent Drafter
//	     │ Guide for creating valid Stigmer Agent YAML files...▍
func renderStreamingTool(tc toolrender.ToolCallInfo, streamContent string) string {
	header := toolrender.RenderRunning(tc)

	if streamContent == "" {
		return header
	}

	// Show at most the last N lines of streaming content to keep the
	// viewport from being overwhelmed by very long outputs.
	const maxPreviewLines = 8
	lines := strings.Split(streamContent, "\n")
	start := 0
	if len(lines) > maxPreviewLines {
		start = len(lines) - maxPreviewLines
	}

	// Format with gutter border (same visual language as file preview blocks).
	var gutterLines []string
	for _, line := range lines[start:] {
		gutterLines = append(gutterLines, dimStyle.Render("     │ ")+line)
	}

	// Add streaming cursor to the last line.
	if len(gutterLines) > 0 {
		gutterLines[len(gutterLines)-1] += "▍"
	}

	return header + "\n" + strings.Join(gutterLines, "\n")
}

// renderSystemContent formats a system message with dimmed styling.
func renderSystemContent(content string) string {
	return systemStyle.Render("ℹ️  " + content)
}

// renderErrorContent formats an error message with bold red styling.
// Visually distinct from system messages to draw immediate attention.
func renderErrorContent(content string) string {
	return errorStyle.Render("❌ " + content)
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

// renderedBlockText returns the final display text for a single content block,
// including expand/collapse decorations for expandable blocks. Returns an empty
// string for blocks that should be skipped (empty content).
//
// This function is the single source of truth for how a block renders in the
// viewport. Both rebuildViewportContent (for the full viewport string) and
// blockStartLine (for scroll-into-view line computation) use it to ensure
// consistent layout.
func renderedBlockText(b contentBlock, blockIdx, focusedIdx int) string {
	text := b.displayContent()
	if text == "" {
		return ""
	}
	if b.expandable {
		text = decorateExpandableBlock(text, b.expanded, blockIdx == focusedIdx)
	}
	return text
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
		text := renderedBlockText(b, i, focusedIndex)
		if text == "" {
			continue
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

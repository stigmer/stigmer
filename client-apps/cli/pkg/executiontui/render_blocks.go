package executiontui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/mdrender"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// Styles for rendering content blocks. These mirror the styles used by the
// existing non-TUI renderer to maintain visual parity.
var (
	systemStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	phaseStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("6"))
	errorStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("1")).Bold(true)
	dimStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))

	// thinkingStyle is used for the ephemeral "Thinking..." indicator that
	// appears in the viewport when the agent is idle (processing a prompt,
	// planning next steps). Muted foreground distinguishes it from real
	// content blocks.
	thinkingStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("243"))
)

// renderAIContent formats an AI message for display. Content containing
// markdown syntax (headers, bold, code blocks, lists) is rendered to
// ANSI-styled terminal text via glamour. Plain text keeps the compact
// inline prefix. width controls word wrapping for the markdown renderer.
func renderAIContent(content string, toolCalls []toolrender.ToolCallInfo, width int) string {
	var parts []string

	if content != "" {
		parts = append(parts, formatAIText(content, width))
	}

	if len(toolCalls) > 0 {
		for _, tc := range toolCalls {
			parts = append(parts, toolrender.Render(tc))
		}
	} else if content == "" {
		parts = append(parts, systemStyle.Render("🤖 Agent is invoking tools..."))
	}

	return strings.Join(parts, "\n")
}

// formatAIText renders the text portion of an AI message. When the content
// contains markdown syntax, it is rendered to styled ANSI text and displayed
// below the prefix on a separate line. Plain text uses the compact inline
// format ("🤖 Agent: text").
func formatAIText(content string, width int) string {
	if !mdrender.HasMarkdown(content) {
		return fmt.Sprintf("🤖 Agent: %s", content)
	}
	rendered := mdrender.Render(content, width)
	return fmt.Sprintf("🤖 Agent:\n%s", rendered)
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

// renderToolFinalized replaces the running indicator (⏳) with a completion
// indicator (✓) for tools that were still in-progress when execution finished
// and had no stored ToolCallInfo for proper stateful block creation.
// This is a last-resort fallback — normally finalizeRunningTools creates a
// proper stateful block.
func renderToolFinalized(runningContent string) string {
	return strings.Replace(runningContent, "⏳", "✓", 1)
}

// renderStreamingTool formats a tool call that is actively streaming output.
// Shows the tool header with a running badge, followed by a gutter-bordered
// preview of the streaming content with a cursor indicator.
//
// Example:
//
//	📝 Write: agent-drafter/SKILL.md ⏳
//	     │ # Agent Drafter
//	     │ Guide for creating valid Stigmer Agent YAML files...▍
func renderStreamingTool(tc toolrender.ToolCallInfo, streamContent string) string {
	header := toolrender.RenderWithBadge(tc, toolrender.StateBadge("running"))

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

// renderThinkingIndicator formats the ephemeral "Thinking..." indicator
// shown in the viewport when the agent is idle during the in_progress phase.
// spinnerView is the current frame of the animated spinner (e.g., "⠋"),
// passed in so the indicator animates with the global spinner tick cycle.
//
// This is NOT a content block — it is appended by refreshViewport() and
// disappears automatically when the next execution event arrives.
func renderThinkingIndicator(spinnerView string) string {
	return thinkingStyle.Render(spinnerView + " Thinking...")
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
			// Suppressed: the tool block badge swap (⏸ → ⏳) already signals
			// the approval was processed and execution resumed.
			return ""
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
	if b.subAgentID != "" {
		text = indentSubAgentBlock(text)
	}
	return text
}

// subAgentIndent is the visual prefix for the first line of a sub-agent block.
// Subsequent lines are indented to align with the content after the prefix.
const subAgentIndent = "  ↳ "

// subAgentContinuation is the indent for continuation lines within a sub-agent
// block. It aligns with the content portion of subAgentIndent (4 characters).
const subAgentContinuation = "    "

// indentSubAgentBlock visually nests a block under its parent task tool block.
// The first line gets a "  ↳ " prefix; subsequent lines are aligned with
// matching whitespace.
func indentSubAgentBlock(text string) string {
	lines := strings.Split(text, "\n")
	lines[0] = subAgentIndent + lines[0]
	for i := 1; i < len(lines); i++ {
		lines[i] = subAgentContinuation + lines[i]
	}
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

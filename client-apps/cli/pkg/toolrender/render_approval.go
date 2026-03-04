package toolrender

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// maxApprovalPreviewLines is the maximum number of content lines shown in
// the collapsed approval result. Uses the same smart cutoff as other compact
// renderers: when total lines <= maxApprovalPreviewLines + 1, all lines are
// shown to avoid a pointless "+ 1 more lines" footer.
const maxApprovalPreviewLines = 10

// approvalSeparatorWidth is the fixed character width of the horizontal
// separator placed between streamed content and the approval menu.
const approvalSeparatorWidth = 24

// rejectBulletStyle colors the bullet red for rejected tool calls.
var rejectBulletStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("1"))

// RenderApprovalResult returns the collapsed post-decision view for a tool
// that went through the approval flow. This replaces ALL expanded content
// (header + streamed content + separator + menu) after the user decides.
//
// action is one of "approve", "skip", "reject":
//   - Approved: green bullet, past-tense summary (e.g., "Wrote 241 lines"),
//     content preview for write/edit tools
//   - Rejected: red bullet, "Rejected", content preview for scrollback record
//   - Skipped: dim bullet, "Skipped", no preview
//
// Shell tools show no content preview for "approve" because their output
// streams separately after approval. Delete tools have no content body.
//
// Examples:
//
//	Approved write:
//	  ● Write(config.go)
//	  └ Wrote 45 lines
//	      package config
//	      … +42 more lines
//
//	Rejected:
//	  ● Write(config.go)
//	  └ Rejected
//	      package config
//	      … +42 more lines
//
//	Skipped:
//	  ● Write(config.go)
//	  └ Skipped
func RenderApprovalResult(tc ToolCallInfo, action string, opts CompactOptions) string {
	info, known := toolDisplayMap[tc.Name]
	if !known {
		return renderApprovalUnknown(tc, action, opts)
	}

	header := renderApprovalHeader(tc, info, action, opts)
	connector := buildApprovalConnector(action, approvedSummary(tc, info))
	result := header + "\n" + connector

	if !shouldShowApprovalPreview(action, info.label) {
		return result
	}

	preview := formatApprovalPreview(resolveDisplayContent(tc, info))
	if preview != "" {
		result += "\n" + preview
	}
	return result
}

// ApprovalSeparator returns a dim horizontal separator for the expanded
// approval view. Phase 3.3 places this between header/content and between
// content/question during the waiting-approval state.
func ApprovalSeparator() string {
	return dimStyle.Render(strings.Repeat("─", approvalSeparatorWidth))
}

// ApprovalQuestion returns the contextual question line for the approval
// prompt. Maps tool types to natural-language verbs so the question reads
// naturally.
//
// Examples:
//
//	"Do you want to create tests/test_tools.sh?"
//	"Do you want to execute rm -rf ./tmp?"
//	"Do you want to delete old_config.yaml?"
//	"Do you want to run custom_tool?"
func ApprovalQuestion(tc ToolCallInfo) string {
	info, known := toolDisplayMap[tc.Name]

	var verb, target string
	if known {
		verb = approvalVerb(info.label)
		target = extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)
		if isShellLabel(info.label) {
			target = truncate(firstLine(target), 60)
		}
	} else {
		verb = "run " + tc.Name
		target = truncate(extractFirstArg(tc.Args), 60)
	}

	if target != "" {
		return fmt.Sprintf("Do you want to %s %s?", verb, target)
	}
	return fmt.Sprintf("Do you want to %s?", verb)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// approvalBullet returns a styled bullet character colored by action:
// green for approved, red for rejected, dim for skipped/unknown.
func approvalBullet(action string) string {
	switch action {
	case "approve":
		return bulletStyle.Render("●")
	case "reject":
		return rejectBulletStyle.Render("●")
	default:
		return dimStyle.Render("●")
	}
}

// renderApprovalHeader builds the first line of the collapsed approval result.
// Uses the same Label(arg) format as compact renderers but with an
// action-colored bullet and no trailing ellipsis.
func renderApprovalHeader(tc ToolCallInfo, info toolDisplayInfo, action string, opts CompactOptions) string {
	bullet := approvalBullet(action)
	primaryVal := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)

	switch {
	case isShellLabel(info.label):
		return fmt.Sprintf("%s %s(%s)", bullet, labelStyle.Render(info.label),
			truncate(firstLine(primaryVal), 60))
	default:
		return fmt.Sprintf("%s %s(%s)", bullet, labelStyle.Render(info.label),
			buildHyperlinkedPath(primaryVal, opts))
	}
}

// buildApprovalConnector produces the └ summary line below the header.
// approvedText is used only for the "approve" action; reject and skip
// have fixed text.
func buildApprovalConnector(action string, approvedText string) string {
	switch action {
	case "approve":
		return dimStyle.Render("└ " + approvedText)
	case "reject":
		return dimStyle.Render("└ Rejected")
	default:
		return dimStyle.Render("└ Skipped")
	}
}

// approvedSummary returns the past-tense result text for an approved tool.
// Write/edit tools include a line count; shell and delete use fixed text.
func approvedSummary(tc ToolCallInfo, info toolDisplayInfo) string {
	switch info.label {
	case "Write":
		return "Wrote " + formatLineCount(countLines(resolveDisplayContent(tc, info)))
	case "Create":
		return "Created " + formatLineCount(countLines(resolveDisplayContent(tc, info)))
	case "Edit":
		return "Edited " + formatLineCount(countLines(resolveDisplayContent(tc, info)))
	case "Delete":
		return "Deleted"
	default:
		return "Approved"
	}
}

// approvalVerb maps a tool display label to the verb used in the approval
// question (e.g., "Write" -> "create", "Shell" -> "execute").
func approvalVerb(label string) string {
	switch label {
	case "Write", "Create":
		return "create"
	case "Edit":
		return "edit"
	case "Shell", "Execute":
		return "execute"
	case "Delete":
		return "delete"
	default:
		return "run"
	}
}

// shouldShowApprovalPreview reports whether the collapsed approval result
// should include a content preview for this action and tool type.
func shouldShowApprovalPreview(action string, label string) bool {
	if action == "skip" {
		return false
	}
	if isShellLabel(label) && action == "approve" {
		return false
	}
	if label == "Delete" {
		return false
	}
	return true
}

// formatApprovalPreview formats content as an indented dim preview block.
// Shows up to maxApprovalPreviewLines lines with 4-space indent. Uses the
// same smart cutoff as other compact renderers: when total lines <=
// maxApprovalPreviewLines + 1, all lines are shown.
func formatApprovalPreview(content string) string {
	if content == "" || strings.TrimSpace(content) == "" {
		return ""
	}

	lines := strings.Split(strings.TrimRight(content, "\n"), "\n")

	showAll := len(lines) <= maxApprovalPreviewLines+1
	visibleCount := len(lines)
	if !showAll {
		visibleCount = maxApprovalPreviewLines
	}

	var b strings.Builder
	for i := 0; i < visibleCount; i++ {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(dimStyle.Render("    " + lines[i]))
	}
	if !showAll {
		b.WriteByte('\n')
		b.WriteString(dimStyle.Render(fmt.Sprintf("    … +%d more lines", len(lines)-visibleCount)))
	}
	return b.String()
}

// renderApprovalUnknown handles unknown/MCP tools that go through approval.
// Uses the tool name as label and tc.Result for preview content (which may
// be empty during the approval flow — unknown tools typically lack content
// at waiting-approval time).
func renderApprovalUnknown(tc ToolCallInfo, action string, opts CompactOptions) string {
	bullet := approvalBullet(action)
	firstVal := extractFirstArg(tc.Args)

	var header string
	if firstVal != "" {
		header = fmt.Sprintf("%s %s(%s)", bullet, labelStyle.Render(tc.Name),
			truncate(firstVal, 60))
	} else {
		header = fmt.Sprintf("%s %s", bullet, labelStyle.Render(tc.Name))
	}

	connector := buildApprovalConnector(action, "Approved")
	result := header + "\n" + connector

	if action == "skip" {
		return result
	}

	preview := formatApprovalPreview(tc.Result)
	if preview != "" {
		result += "\n" + preview
	}
	return result
}

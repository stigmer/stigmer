package toolrender

import (
	"fmt"
	"sort"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// maxApprovalPreviewLines is the maximum number of content lines shown in
// the collapsed approval result. Uses the same smart cutoff as other compact
// renderers: when total lines <= maxApprovalPreviewLines + 1, all lines are
// shown to avoid a pointless "+ 1 more lines" footer.
const maxApprovalPreviewLines = 10

// defaultApprovalSeparatorWidth is the fallback separator width used when
// the caller cannot determine terminal width (e.g., in tests).
const defaultApprovalSeparatorWidth = 80

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

// ApprovalSeparator returns a dim horizontal separator spanning the given
// width. Used in the expanded approval view between header/content and
// between content/question during the waiting-approval state.
func ApprovalSeparator(width int) string {
	if width <= 0 {
		width = defaultApprovalSeparatorWidth
	}
	return dimStyle.Render(strings.Repeat("─", width))
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
		target = formatApprovalArgs(tc.Args)
	}

	if target != "" {
		return fmt.Sprintf("Do you want to %s %s?", verb, target)
	}
	return fmt.Sprintf("Do you want to %s?", verb)
}

// ExpandedApprovalHeader returns the header line for the expanded approval
// view shown before the user makes a decision. Uses a green bullet (same
// as normal tool calls) since no action has been taken yet. The action
// coloring (green/red/dim) only applies to the collapsed post-decision view.
func ExpandedApprovalHeader(tc ToolCallInfo, opts CompactOptions) string {
	info, known := toolDisplayMap[tc.Name]
	if !known {
		name := tc.Name
		if tc.ServerName != "" {
			name = tc.ServerName + "/" + tc.Name
		}
		return fmt.Sprintf("%s %s", bulletStyle.Render("●"), labelStyle.Render(name))
	}

	bullet := bulletStyle.Render("●")
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

// ExpandedApprovalContent extracts the full display content for a tool call.
// For write/edit tools this is the file content from args; for shell tools
// this is the command; for read/discovery tools this is the result.
//
// This is the public interface to resolveDisplayContent — the command layer
// needs it to build the expanded approval view but cannot access the private
// toolDisplayMap or resolveDisplayContent directly.
func ExpandedApprovalContent(tc ToolCallInfo) string {
	info, known := toolDisplayMap[tc.Name]
	if !known {
		return extractFirstArg(tc.Args)
	}
	return resolveDisplayContent(tc, info)
}

// ShouldSuppressCompletion reports whether the ToolCompletedEvent for an
// approved or skipped tool should be suppressed. Write, edit, create, and
// delete tools have their outcome fully represented by the collapsed
// approval result (RenderApprovalResult). Shell tools are NOT suppressed
// here — their completion is intercepted by the streaming tool handler
// (completeStreamingTool) which erases the streamed output and prints the
// compact result.
func ShouldSuppressCompletion(toolName string) bool {
	if IsWriteOrEditTool(toolName) {
		return true
	}
	info, ok := toolDisplayMap[toolName]
	if ok && info.label == "Delete" {
		return true
	}
	return false
}

// StreamTruncationIndicator returns a dim single-line indicator shown when
// streaming content exceeds the display cap. overflow is the number of
// content lines beyond the cap.
func StreamTruncationIndicator(overflow int) string {
	if overflow <= 0 {
		return dimStyle.Render("… content continues") + "\n"
	}
	return dimStyle.Render(fmt.Sprintf("… +%d more lines", overflow)) + "\n"
}

// TruncateContent caps content to maxLines lines and clamps each line to
// maxWidth visible characters. Returns the truncated content with a
// "… +N more lines" footer if lines were removed.
//
// maxWidth uses ANSI-aware truncation so escape codes (colors, hyperlinks)
// do not count toward the visible width. This prevents line wrapping in the
// expanded approval view, making the display row count deterministic.
//
// A maxLines <= 0 or maxWidth <= 0 returns the content unchanged.
func TruncateContent(content string, maxLines, maxWidth int) string {
	if content == "" || maxLines <= 0 || maxWidth <= 0 {
		return content
	}

	lines := strings.Split(strings.TrimRight(content, "\n"), "\n")

	clamped := lines
	if len(clamped) > maxLines {
		clamped = clamped[:maxLines]
	}

	var b strings.Builder
	for i, line := range clamped {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(truncateANSI(line, maxWidth))
	}

	if len(lines) > maxLines {
		b.WriteByte('\n')
		b.WriteString(dimStyle.Render(fmt.Sprintf("… +%d more lines", len(lines)-maxLines)))
	}

	return b.String()
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
// Shows the tool name (with optional server prefix), input args for context,
// and tc.Result for preview content (which may be empty during the approval
// flow — unknown tools typically lack content at waiting-approval time).
func renderApprovalUnknown(tc ToolCallInfo, action string, opts CompactOptions) string {
	bullet := approvalBullet(action)
	name := tc.Name
	if tc.ServerName != "" {
		name = tc.ServerName + "/" + tc.Name
	}
	header := fmt.Sprintf("%s %s", bullet, labelStyle.Render(name))

	connector := buildApprovalConnector(action, "Approved")
	result := header + "\n" + connector

	if action == "skip" {
		return result
	}

	if inputLines := formatInputArgs(tc.Args, maxInputArgs); inputLines != "" {
		result += "\n" + inputLines
	}

	preview := formatApprovalPreview(tc.Result)
	if preview != "" {
		result += "\n" + preview
	}
	return result
}

// formatApprovalArgs produces a compact parenthesized summary of tool
// arguments for the approval question. Shows up to 2 key=value pairs
// inline, truncated for readability.
//
// Examples:
//
//	"(query=\"planton cloud...\")"
//	"(org=\"default\", name=\"planton-cloud\")"
//	""  (empty args)
func formatApprovalArgs(args map[string]interface{}) string {
	if len(args) == 0 {
		return ""
	}

	keys := make([]string, 0, len(args))
	for k := range args {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	const maxApprovalInlineArgs = 2
	visibleCount := len(keys)
	if visibleCount > maxApprovalInlineArgs {
		visibleCount = maxApprovalInlineArgs
	}

	parts := make([]string, visibleCount)
	for i := 0; i < visibleCount; i++ {
		parts[i] = formatInlineArg(keys[i], args[keys[i]])
	}

	summary := "(" + strings.Join(parts, ", ") + ")"
	if len(keys) > maxApprovalInlineArgs {
		summary = "(" + strings.Join(parts, ", ") + ", ...)"
	}
	return truncate(summary, 60)
}

// formatInlineArg renders a single key=value pair for inline display.
func formatInlineArg(key string, val interface{}) string {
	switch v := val.(type) {
	case string:
		return fmt.Sprintf("%s=%q", key, truncate(v, 30))
	case nil:
		return key + "=null"
	default:
		return fmt.Sprintf("%s=%s", key, formatArgValue(val))
	}
}

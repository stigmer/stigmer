package toolrender

import (
	"fmt"
	"sort"
	"strings"

	"charm.land/lipgloss/v2"
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
//   - Rejected: red bullet, descriptive message, content preview
//   - Skipped: dim bullet, descriptive message, content preview
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
//	Rejected write:
//	  ● Write(config.go)
//	  └ User rejected create to config.go
//	      package config
//	      … +42 more lines
//
//	Skipped write:
//	  ● Write(config.go)
//	  └ User skipped create config.go
//	      package config
//	      … +42 more lines
func RenderApprovalResult(tc ToolCallInfo, action string, opts CompactOptions) string {
	info, known := toolDisplayMap[tc.Name]
	if !known {
		return renderApprovalUnknown(tc, action, opts)
	}

	header := renderApprovalHeader(tc, info, action, opts)
	connector := buildApprovalConnector(action, approvedSummary(tc, info), tc)
	result := header + "\n" + connector

	if !shouldShowApprovalPreview(action, info.label) {
		return result
	}

	preview := resolveApprovalPreview(tc, info, "")
	if preview != "" {
		result += "\n" + preview
	}
	return result
}

// RenderApprovalResultWithOldContent renders the collapsed post-decision
// approval result for a write tool where the existing file content is known.
// When oldContent is non-empty, the preview shows a unified diff instead of
// the raw new content. When oldContent is empty, falls back to standard
// behavior (raw content preview).
func RenderApprovalResultWithOldContent(tc ToolCallInfo, action string, oldContent string, opts CompactOptions) string {
	info, known := toolDisplayMap[tc.Name]
	if !known || oldContent == "" {
		return RenderApprovalResult(tc, action, opts)
	}

	header := renderApprovalHeader(tc, info, action, opts)
	connector := buildApprovalConnector(action, approvedSummary(tc, info), tc)
	result := header + "\n" + connector

	if !shouldShowApprovalPreview(action, info.label) {
		return result
	}

	preview := resolveApprovalPreview(tc, info, oldContent)
	if preview != "" {
		result += "\n" + preview
	}
	return result
}

// resolveApprovalPreview returns the styled preview content for a collapsed
// approval result. For edit tools (when old_text is available in args) and
// write tools (when oldContent is provided), it returns a diff preview.
// Otherwise falls back to the standard raw content preview.
func resolveApprovalPreview(tc ToolCallInfo, info toolDisplayInfo, oldContent string) string {
	if info.label == "Edit" {
		oldText := extractPrimaryArgWithFallbacks(tc.Args, "old_text", []string{"old_string"})
		newText := extractPrimaryArgWithFallbacks(tc.Args, info.contentArgField, info.contentArgFallbacks)
		if oldText != "" && newText != "" {
			if preview := FormatDiffPreview(oldText, newText, maxApprovalPreviewLines); preview != "" {
				return preview
			}
		}
	}

	if info.label == "Write" && oldContent != "" {
		newContent := resolveDisplayContent(tc, info)
		if newContent != "" {
			if preview := FormatDiffPreview(oldContent, newContent, maxApprovalPreviewLines); preview != "" {
				return preview
			}
		}
	}

	return formatApprovalPreview(resolveDisplayContent(tc, info))
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

// ExpandedApprovalContent extracts the full display content for a tool call,
// designed to give the user complete visibility into what they are approving.
//
// For edit tools, a unified diff between old_text and new_text is returned
// so the user can see exactly what lines are being changed. When old_text
// is not available in the args, it falls back to showing new_text as-is.
//
// For write/edit tools this is the file content from args. For shell tools
// this is the full command (pre-approval) or the result (post-execution).
// For read/discovery tools this is the result.
//
// Shell tools receive special handling: when Result is empty (pre-approval
// state), the full command text from args is returned so the user can see
// exactly what will be executed before making an approval decision. This
// mirrors how write tools show their full file content in the expanded view.
//
// For unknown/MCP tools, all arguments are formatted as key-value pairs
// without truncation so the user can see every parameter being passed. This
// ensures full transparency for approval decisions on third-party tools.
//
// This is the public interface to resolveDisplayContent — the command layer
// needs it to build the expanded approval view but cannot access the private
// toolDisplayMap or resolveDisplayContent directly.
func ExpandedApprovalContent(tc ToolCallInfo) string {
	info, known := toolDisplayMap[tc.Name]
	if !known {
		return formatExpandedArgs(tc.Args)
	}

	if info.label == "Edit" {
		oldText := extractPrimaryArgWithFallbacks(tc.Args, "old_text", []string{"old_string"})
		newText := extractPrimaryArgWithFallbacks(tc.Args, info.contentArgField, info.contentArgFallbacks)
		if oldText != "" && newText != "" {
			if diff := FormatDiff(oldText, newText); diff != "" {
				return diff
			}
		}
	}

	content := resolveDisplayContent(tc, info)
	if content == "" && isShellLabel(info.label) {
		return extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)
	}
	return content
}

// ExpandedApprovalContentWithExisting returns the expanded approval content
// for a tool call, using the provided existingContent as the "old" side of
// a diff when the tool is a write tool (overwriting an existing file).
//
// This is used by the TUI layer for write tools where the existing file
// content has been read from the local filesystem. When existingContent is
// empty, falls back to the standard ExpandedApprovalContent behavior.
func ExpandedApprovalContentWithExisting(tc ToolCallInfo, existingContent string) string {
	if existingContent == "" {
		return ExpandedApprovalContent(tc)
	}

	info, known := toolDisplayMap[tc.Name]
	if !known {
		return ExpandedApprovalContent(tc)
	}

	if info.label == "Write" {
		newContent := resolveDisplayContent(tc, info)
		if newContent != "" {
			if diff := FormatDiff(existingContent, newContent); diff != "" {
				return diff
			}
		}
	}

	return ExpandedApprovalContent(tc)
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
// approvedText is used only for the "approve" action. For "reject" and
// "skip", the connector includes the verb and path (e.g. "User rejected
// write to config.go", "User skipped write to config.go").
func buildApprovalConnector(action string, approvedText string, tc ToolCallInfo) string {
	switch action {
	case "approve":
		return dimStyle.Render("└ " + approvedText)
	case "reject":
		info, known := toolDisplayMap[tc.Name]
		if known {
			verb := approvalVerb(info.label)
			path := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)
			if path != "" {
				return dimStyle.Render(fmt.Sprintf("└ User rejected %s to %s", verb, path))
			}
		}
		return dimStyle.Render("└ Rejected")
	case "skip":
		info, known := toolDisplayMap[tc.Name]
		if known {
			verb := approvalVerb(info.label)
			path := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)
			if path != "" {
				return dimStyle.Render(fmt.Sprintf("└ User skipped %s %s", verb, path))
			}
		}
		return dimStyle.Render("└ Skipped")
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
// Skip and reject both show previews for write/edit/create tools so the
// user can see what was proposed. Shell-approve is excluded because the
// output streams separately. Delete has no content body.
func shouldShowApprovalPreview(action string, label string) bool {
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

	connector := buildApprovalConnector(action, "Approved", tc)
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
//	"(query=\"planton...\")"
//	"(org=\"default\", name=\"planton\")"
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

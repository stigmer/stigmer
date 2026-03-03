package executiontui

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/charmbracelet/lipgloss"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// Styles for the terminal-style command display in shell tool approvals.
var (
	shellPromptStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("2"))
	shellArgStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
)

const (
	// shellExpandThreshold is the command line count above which a shell
	// approval block becomes expandable. Commands with this many lines or
	// fewer are shown in full without expand/collapse.
	shellExpandThreshold = 5

	// genericExpandThreshold is the visual line count above which a
	// non-shell approval block becomes expandable. A single arg entry
	// with a multi-line value (e.g., file content) counts as many visual
	// lines, not one.
	genericExpandThreshold = 5

	// genericPreviewLines is the number of visual lines shown in the
	// collapsed preview for generic (non-shell) approval blocks.
	genericPreviewLines = 3
)

// renderApprovalContent returns both a compact preview and the full approval
// prompt text for display in the viewport. When the content is short enough
// to show inline, preview and full are identical and the block will not be
// expandable. When content exceeds the line threshold, the preview shows a
// compact summary with a "(+N more lines)" indicator while full shows
// everything.
//
// Shell/execute tools get a terminal-style prompt that shows the command with
// a `$` prefix, suppressing the redundant "Tool:" line and duplicate message.
// All other tools use the generic key-value format.
//
// argsPreview should be the raw sanitized JSON from the backend. If it has
// already been formatted (pre-formatted text), the fallback path handles it.
func renderApprovalContent(toolName, argsPreview, message string, fromSubAgent bool, subAgentName string) (preview, full string) {
	if toolrender.IsShellTool(toolName) {
		return renderShellApprovalContent(argsPreview, message, fromSubAgent, subAgentName)
	}
	return renderGenericApprovalContent(toolName, argsPreview, message, fromSubAgent, subAgentName)
}

// renderShellApprovalContent builds the preview and full versions for a
// shell/execute tool approval block.
//
// Full view (multi-line command):
//
//	⏸  APPROVAL REQUIRED
//
//	   $ rm -f file1.txt
//	   rm -f file2.txt
//	   rm -f file3.txt
//	   timeout: 120
//
// Preview view (when command exceeds shellExpandThreshold lines):
//
//	⏸  APPROVAL REQUIRED
//
//	   $ rm -f file1.txt
//	   (+9 more lines)
//	   timeout: 120
func renderShellApprovalContent(argsPreview, message string, fromSubAgent bool, subAgentName string) (preview, full string) {
	header := renderApprovalHeader(fromSubAgent, subAgentName)
	command, secondaryArgs := extractShellCommand(argsPreview)

	full = buildShellApproval(header, command, message, secondaryArgs, 0)

	if command != "" {
		cmdLines := strings.Split(command, "\n")
		if len(cmdLines) > shellExpandThreshold {
			preview = buildShellApproval(header, command, message, secondaryArgs, 1)
			return preview, full
		}
	}

	return full, full
}

// buildShellApproval constructs the approval block text for a shell tool.
// When maxCmdLines > 0, the command is truncated to that many lines with a
// "(+N more lines)" indicator. When maxCmdLines == 0, all lines are shown.
func buildShellApproval(header, command, message string, secondaryArgs []string, maxCmdLines int) string {
	var lines []string
	lines = append(lines, header, "")

	if command != "" {
		cmdLines := strings.Split(command, "\n")
		showAll := maxCmdLines <= 0 || len(cmdLines) <= maxCmdLines

		if showAll {
			for i, cl := range cmdLines {
				if i == 0 {
					lines = append(lines, "   "+shellPromptStyle.Render("$ "+cl))
				} else {
					lines = append(lines, "   "+shellPromptStyle.Render(cl))
				}
			}
		} else {
			for i := 0; i < maxCmdLines; i++ {
				if i == 0 {
					lines = append(lines, "   "+shellPromptStyle.Render("$ "+cmdLines[i]))
				} else {
					lines = append(lines, "   "+shellPromptStyle.Render(cmdLines[i]))
				}
			}
			remaining := len(cmdLines) - maxCmdLines
			lines = append(lines, "   "+shellArgStyle.Render(fmt.Sprintf("(+%d more lines)", remaining)))
		}
	} else if message != "" && !isRedundantShellMessage(message) {
		lines = append(lines, fmt.Sprintf("   %s", message))
	}

	for _, arg := range secondaryArgs {
		lines = append(lines, "   "+shellArgStyle.Render(arg))
	}

	return strings.Join(lines, "\n")
}

// renderGenericApprovalContent builds the preview and full versions for a
// non-shell tool approval block.
func renderGenericApprovalContent(toolName, argsPreview, message string, fromSubAgent bool, subAgentName string) (preview, full string) {
	header := renderApprovalHeader(fromSubAgent, subAgentName)
	argLines := formatGenericArgs(argsPreview)

	full = buildGenericApproval(header, toolName, message, argLines, 0)

	if countArgVisualLines(argLines) > genericExpandThreshold {
		preview = buildGenericApproval(header, toolName, message, argLines, genericPreviewLines)
		return preview, full
	}

	return full, full
}

// buildGenericApproval constructs the approval block text for a non-shell tool.
// When maxVisualLines > 0, args content is truncated to that many visual lines
// with an indicator. A single arg entry with embedded newlines (e.g., file
// content) counts as multiple visual lines. When maxVisualLines == 0, all
// lines are shown.
func buildGenericApproval(header, toolName, message string, argLines []string, maxVisualLines int) string {
	var lines []string
	lines = append(lines, header, "")

	if message != "" {
		lines = append(lines, fmt.Sprintf("   %s", message))
	}
	if toolName != "" {
		lines = append(lines, fmt.Sprintf("   Tool: %s", toolName))
	}

	totalVisual := countArgVisualLines(argLines)
	if maxVisualLines <= 0 || totalVisual <= maxVisualLines {
		for _, al := range argLines {
			for _, vl := range strings.Split(al, "\n") {
				lines = append(lines, fmt.Sprintf("   %s", vl))
			}
		}
	} else {
		shown := 0
		for _, al := range argLines {
			for _, vl := range strings.Split(al, "\n") {
				if shown >= maxVisualLines {
					remaining := totalVisual - shown
					lines = append(lines, "   "+shellArgStyle.Render(fmt.Sprintf("(+%d more lines)", remaining)))
					return strings.Join(lines, "\n")
				}
				lines = append(lines, fmt.Sprintf("   %s", vl))
				shown++
			}
		}
	}

	return strings.Join(lines, "\n")
}

// countArgVisualLines returns the total number of visual lines across all arg
// entries. Multi-line values (containing embedded newlines) contribute one
// visual line per newline-delimited segment.
func countArgVisualLines(argLines []string) int {
	n := 0
	for _, al := range argLines {
		n += strings.Count(al, "\n") + 1
	}
	return n
}

// formatGenericArgs extracts key-value lines from argsPreview for display.
// If argsPreview is valid JSON, each field is formatted as "key: value" in
// alphabetical order. Otherwise, each non-empty line of the pre-formatted
// text is returned as-is.
func formatGenericArgs(argsPreview string) []string {
	if argsPreview == "" {
		return nil
	}

	var args map[string]interface{}
	if err := json.Unmarshal([]byte(argsPreview), &args); err == nil {
		return formatArgMap(args)
	}

	var result []string
	for _, line := range strings.Split(argsPreview, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

// formatArgMap formats a JSON-decoded arg map into sorted "key: value" lines.
func formatArgMap(args map[string]interface{}) []string {
	keys := make([]string, 0, len(args))
	for k := range args {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var lines []string
	for _, k := range keys {
		lines = append(lines, fmt.Sprintf("%s: %s", k, formatArgValue(args[k])))
	}
	return lines
}

// formatArgValue converts a JSON-decoded value to a human-readable string.
func formatArgValue(v interface{}) string {
	switch val := v.(type) {
	case string:
		return val
	case float64:
		if val == float64(int64(val)) {
			return fmt.Sprintf("%d", int64(val))
		}
		return fmt.Sprintf("%g", val)
	case bool:
		return fmt.Sprintf("%t", val)
	case nil:
		return "null"
	default:
		b, err := json.MarshalIndent(val, "", "  ")
		if err != nil {
			return fmt.Sprintf("%v", val)
		}
		return string(b)
	}
}

// renderApprovalHeader returns the bold "APPROVAL REQUIRED" header line,
// optionally annotated with the originating sub-agent name.
func renderApprovalHeader(fromSubAgent bool, subAgentName string) string {
	header := "⏸  APPROVAL REQUIRED"
	if fromSubAgent && subAgentName != "" {
		header = fmt.Sprintf("⏸  APPROVAL REQUIRED  (sub-agent: %s)", subAgentName)
	}
	return lipgloss.NewStyle().Bold(true).Render(header)
}

// extractShellCommand parses the argsPreview (which may be raw JSON from the
// backend or pre-formatted text) and returns the command string plus any
// secondary arguments formatted as "key: value" lines.
func extractShellCommand(argsPreview string) (command string, secondary []string) {
	// Try parsing as JSON first (raw args from the backend).
	var args map[string]interface{}
	if err := json.Unmarshal([]byte(argsPreview), &args); err == nil {
		if cmd, ok := args["command"]; ok {
			command = fmt.Sprintf("%v", cmd)
		}
		keys := make([]string, 0, len(args))
		for k := range args {
			if k != "command" {
				keys = append(keys, k)
			}
		}
		sort.Strings(keys)
		for _, k := range keys {
			secondary = append(secondary, fmt.Sprintf("%s: %v", k, args[k]))
		}
		return command, secondary
	}

	// Already formatted by approval.FormatArgs — parse "Command: ..." lines.
	for _, line := range strings.Split(argsPreview, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "Command:") {
			command = strings.TrimSpace(strings.TrimPrefix(trimmed, "Command:"))
		} else {
			secondary = append(secondary, trimmed)
		}
	}
	return command, secondary
}

// isRedundantShellMessage reports whether the backend message is just
// "Execute command: <cmd>" — a template that duplicates the command arg.
func isRedundantShellMessage(message string) bool {
	return strings.HasPrefix(message, "Execute command:")
}

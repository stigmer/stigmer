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

// renderApprovalPrompt formats the approval request display shown in the
// viewport. The block provides full context about what needs approval so the
// user can make an informed decision. Action keys live in the footer, not here.
//
// Shell/execute tools get a terminal-style prompt that shows the command with
// a `$` prefix, suppressing the redundant "Tool:" line and duplicate message.
// All other tools use the generic key-value format.
func renderApprovalPrompt(toolName, argsPreview, message string, fromSubAgent bool, subAgentName string) string {
	if toolrender.IsShellTool(toolName) {
		return renderShellApprovalPrompt(argsPreview, message, fromSubAgent, subAgentName)
	}
	return renderGenericApprovalPrompt(toolName, argsPreview, message, fromSubAgent, subAgentName)
}

// renderShellApprovalPrompt formats the approval block for shell/execute tools
// with a terminal-style command display:
//
//	⏸  APPROVAL REQUIRED
//
//	   $ python3 script.py --flag value
//	   working_directory: /workspace
//	   timeout: 120
func renderShellApprovalPrompt(argsPreview, message string, fromSubAgent bool, subAgentName string) string {
	var lines []string

	lines = append(lines, renderApprovalHeader(fromSubAgent, subAgentName))
	lines = append(lines, "")

	command, secondaryArgs := extractShellCommand(argsPreview)

	if command != "" {
		lines = append(lines, "   "+shellPromptStyle.Render("$ "+command))
	} else if message != "" && !isRedundantShellMessage(message) {
		lines = append(lines, fmt.Sprintf("   %s", message))
	}

	for _, arg := range secondaryArgs {
		lines = append(lines, "   "+shellArgStyle.Render(arg))
	}

	return strings.Join(lines, "\n")
}

// renderGenericApprovalPrompt is the default approval block format for
// non-shell tools: header, optional message, tool name, and args preview.
func renderGenericApprovalPrompt(toolName, argsPreview, message string, fromSubAgent bool, subAgentName string) string {
	var lines []string

	lines = append(lines, renderApprovalHeader(fromSubAgent, subAgentName))
	lines = append(lines, "")

	if message != "" {
		lines = append(lines, fmt.Sprintf("   %s", message))
	}
	if toolName != "" {
		lines = append(lines, fmt.Sprintf("   Tool: %s", toolName))
	}
	if argsPreview != "" {
		for _, line := range strings.Split(argsPreview, "\n") {
			lines = append(lines, fmt.Sprintf("   %s", line))
		}
	}

	return strings.Join(lines, "\n")
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

// extractShellCommand parses the argsPreview (which may be pre-formatted text
// from approval.FormatArgs or raw JSON) and returns the command string plus
// any secondary arguments formatted as "key: value" lines.
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

package executiontui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// Styles for approval confirmation blocks. Colors follow semantic conventions:
// green (2) for success, yellow (3) for warning, red (1) for error.
var (
	approvalApproveStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("2"))
	approvalSkipStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("3"))
	approvalRejectStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("1"))
)

// renderApprovalPrompt formats the approval request display shown in the
// viewport. The block provides full context about what needs approval so the
// user can make an informed decision. Action keys live in the footer, not here.
func renderApprovalPrompt(toolName, argsPreview, message string, fromSubAgent bool, subAgentName string) string {
	var lines []string

	header := "⏸  APPROVAL REQUIRED"
	if fromSubAgent && subAgentName != "" {
		header = fmt.Sprintf("⏸  APPROVAL REQUIRED  (sub-agent: %s)", subAgentName)
	}
	lines = append(lines, lipgloss.NewStyle().Bold(true).Render(header))
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

// renderApprovalConfirmation formats the confirmation block appended after the
// user responds to an approval prompt. The styling matches the action semantics:
// green for approve, yellow for skip, red for reject.
func renderApprovalConfirmation(action, toolName string) string {
	label := toolName
	if label == "" {
		label = "tool call"
	}

	switch action {
	case "approve":
		return approvalApproveStyle.Render(fmt.Sprintf("✅ Approved: %s", label))
	case "skip":
		return approvalSkipStyle.Render(fmt.Sprintf("⏭  Skipped: %s", label))
	case "reject":
		return approvalRejectStyle.Render(fmt.Sprintf("❌ Rejected: %s", label))
	default:
		return systemStyle.Render(fmt.Sprintf("Approval: %s (%s)", action, label))
	}
}

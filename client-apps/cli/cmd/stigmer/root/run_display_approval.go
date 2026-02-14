package root

import (
	"fmt"
	"strings"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/panel"
)

// displayPendingApproval renders the tool approval request as a styled panel.
// Called when execution enters WAITING_FOR_APPROVAL phase to show the user
// what tool is requesting approval, with what arguments, and how long it has
// been waiting.
func displayPendingApproval(pa *agentexecutionv1.PendingApproval) {
	if pa == nil {
		return
	}

	content := buildApprovalContent(pa)

	output := panel.Render(content, panel.Options{
		Title: "APPROVAL REQUIRED",
		Style: panel.StyleWarning,
	})

	fmt.Println(output)
	fmt.Println()
}

// buildApprovalContent assembles the labeled sections displayed inside the
// approval panel. Sections are separated by blank lines for visual clarity.
func buildApprovalContent(pa *agentexecutionv1.PendingApproval) string {
	var sections []string

	// Tool name — always present
	sections = append(sections, fmt.Sprintf("Tool:  %s", pa.ToolName))

	// Sub-agent indicator — only when approval originates from a sub-agent
	if pa.FromSubAgent && pa.SubAgentName != "" {
		sections = append(sections, fmt.Sprintf("From:  %s (sub-agent)", pa.SubAgentName))
	}

	// Approval message from the agent
	if pa.Message != "" {
		sections = append(sections, "")
		sections = append(sections, fmt.Sprintf("Message: %s", pa.Message))
	}

	// Tool arguments, formatted by tool type
	if pa.ArgsPreview != "" {
		formatted := approval.FormatArgs(pa.ToolName, pa.ArgsPreview)
		if formatted != "" {
			sections = append(sections, "")
			sections = append(sections, "Arguments:")
			sections = append(sections, formatted)
		}
	}

	// Waiting duration
	sections = append(sections, "")
	sections = append(sections, fmt.Sprintf("Waiting for: %s", formatWaitingDuration(pa.RequestedAt)))

	return strings.Join(sections, "\n")
}

// formatWaitingDuration calculates and formats the duration since the approval
// was requested. Returns a human-readable string like "15s", "2m30s", or "just now".
func formatWaitingDuration(requestedAt string) string {
	if requestedAt == "" {
		return "unknown"
	}

	t, err := time.Parse(time.RFC3339, requestedAt)
	if err != nil {
		return "unknown"
	}

	duration := time.Since(t)
	if duration < time.Second {
		return "just now"
	}

	return duration.Truncate(time.Second).String()
}

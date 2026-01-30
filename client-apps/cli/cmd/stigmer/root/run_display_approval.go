package root

import (
	"fmt"
	"strings"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
)

// displayPendingApproval shows the tool approval request details.
// Called when execution enters WAITING_FOR_APPROVAL phase to display
// the tool name, arguments, and waiting duration to the user.
func displayPendingApproval(approval *agentexecutionv1.PendingApproval) {
	if approval == nil {
		return
	}

	const separatorWidth = 60
	fmt.Println(strings.Repeat("─", separatorWidth))
	cliprint.PrintWarning("APPROVAL REQUIRED")
	fmt.Println()

	// Sub-agent indicator (if applicable)
	if approval.FromSubAgent && approval.SubAgentName != "" {
		fmt.Printf("   Sub-agent: %s\n", approval.SubAgentName)
	}

	// Tool information
	fmt.Printf("   Tool: %s\n", approval.ToolName)
	if approval.Message != "" {
		fmt.Printf("   Message: %s\n", approval.Message)
	}

	// Arguments preview (formatted JSON)
	if approval.ArgsPreview != "" {
		fmt.Println()
		fmt.Println("   Arguments:")
		fmt.Print(formatApprovalArgsPreview(approval.ArgsPreview))
	}

	// Waiting duration
	fmt.Println()
	fmt.Printf("   Waiting for: %s\n", formatWaitingDuration(approval.RequestedAt))

	fmt.Println(strings.Repeat("─", separatorWidth))
	fmt.Println()
}

// formatWaitingDuration calculates and formats the duration since the approval was requested.
// Returns a human-readable duration string like "15s", "2m30s", or "just now".
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

// formatApprovalArgsPreview indents each line of the JSON args preview for display.
// Returns the formatted string with consistent indentation.
func formatApprovalArgsPreview(argsPreview string) string {
	if argsPreview == "" {
		return ""
	}

	const indent = "      "
	lines := strings.Split(argsPreview, "\n")
	var result strings.Builder
	result.Grow(len(argsPreview) + len(indent)*len(lines))

	for _, line := range lines {
		result.WriteString(indent)
		result.WriteString(line)
		result.WriteString("\n")
	}

	return result.String()
}

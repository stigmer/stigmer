package root

import (
	"fmt"
	"strings"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/approval"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/panel"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

// Note: summaryPanelWidth() from run_display_summary.go is reused here
// to maintain consistent panel widths across approval and summary displays.

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
		Width: summaryPanelWidth(),
	})

	fmt.Println(output)
	fmt.Println()
}

// buildApprovalContent assembles the labeled sections displayed inside the
// approval panel. Shell/execute tools get a terminal-style command display;
// all other tools use the generic format with tool name, message, and args.
func buildApprovalContent(pa *agentexecutionv1.PendingApproval) string {
	if toolrender.IsShellTool(pa.ToolName) {
		return buildShellApprovalContent(pa)
	}
	return buildGenericApprovalContent(pa)
}

// buildShellApprovalContent formats the approval panel for shell/execute tools
// with a terminal-style command display, suppressing the redundant "Tool:" and
// duplicate "Execute command:" message.
func buildShellApprovalContent(pa *agentexecutionv1.PendingApproval) string {
	var sections []string

	if pa.FromSubAgent && pa.SubAgentName != "" {
		sections = append(sections, fmt.Sprintf("From:  %s (sub-agent)", pa.SubAgentName))
		sections = append(sections, "")
	}

	formatted := approval.FormatArgs(pa.ToolName, pa.ArgsPreview)
	command, secondary := parseShellFormattedArgs(formatted)
	if command != "" {
		sections = append(sections, fmt.Sprintf("$ %s", command))
	} else if pa.Message != "" && !strings.HasPrefix(pa.Message, "Execute command:") {
		sections = append(sections, pa.Message)
	}

	for _, line := range secondary {
		sections = append(sections, line)
	}

	sections = append(sections, "")
	sections = append(sections, fmt.Sprintf("Waiting for: %s", formatWaitingDuration(pa.RequestedAt)))

	return strings.Join(sections, "\n")
}

// buildGenericApprovalContent is the default approval panel format for
// non-shell tools: tool name, sub-agent, message, and formatted arguments.
func buildGenericApprovalContent(pa *agentexecutionv1.PendingApproval) string {
	var sections []string

	sections = append(sections, fmt.Sprintf("Tool:  %s", pa.ToolName))

	if pa.FromSubAgent && pa.SubAgentName != "" {
		sections = append(sections, fmt.Sprintf("From:  %s (sub-agent)", pa.SubAgentName))
	}

	if pa.Message != "" {
		sections = append(sections, "")
		sections = append(sections, fmt.Sprintf("Message: %s", pa.Message))
	}

	if pa.Message == "" && pa.ArgsPreview != "" {
		formatted := approval.FormatArgs(pa.ToolName, pa.ArgsPreview)
		if formatted != "" {
			sections = append(sections, "")
			sections = append(sections, "Arguments:")
			sections = append(sections, formatted)
		}
	}

	sections = append(sections, "")
	sections = append(sections, fmt.Sprintf("Waiting for: %s", formatWaitingDuration(pa.RequestedAt)))

	return strings.Join(sections, "\n")
}

// parseShellFormattedArgs splits pre-formatted shell args (from
// approval.FormatArgs) into the command and secondary arguments.
// The command is the value following "Command:" on the first matching line.
func parseShellFormattedArgs(formatted string) (command string, secondary []string) {
	for _, line := range strings.Split(formatted, "\n") {
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

// formatWaitingDuration calculates and formats the duration since the approval
// was requested. Returns a human-readable string like "15s", "2m30s", or "just now".
//
// The parser tries multiple timestamp formats for resilience: RFC 3339 (with
// timezone), RFC 3339 Nano, and bare ISO 8601 without timezone (which the
// Python agent-runner historically produced). If all fail, "unknown" is
// returned.
func formatWaitingDuration(requestedAt string) string {
	if requestedAt == "" {
		return "unknown"
	}

	t, err := parseTimestamp(requestedAt)
	if err != nil {
		return "unknown"
	}

	duration := time.Since(t)
	if duration < time.Second {
		return "just now"
	}

	return duration.Truncate(time.Second).String()
}

// timestampFormats lists the formats tried by parseTimestamp, ordered from most
// to least specific. The bare ISO 8601 layout (no timezone) is a fallback for
// timestamps produced by Python's datetime.utcnow().isoformat() before the
// "Z" suffix was standardised across the codebase.
var timestampFormats = []string{
	time.RFC3339Nano,
	time.RFC3339,
	"2006-01-02T15:04:05.999999", // bare ISO 8601 with microseconds (no tz)
	"2006-01-02T15:04:05",        // bare ISO 8601 (no tz)
}

// parseTimestamp attempts to parse a timestamp string against several known
// layouts. For bare (no-timezone) formats the value is assumed to be UTC.
func parseTimestamp(value string) (time.Time, error) {
	for _, layout := range timestampFormats {
		t, err := time.Parse(layout, value)
		if err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unrecognised timestamp format: %q", value)
}

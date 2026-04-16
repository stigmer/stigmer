// Package execution provides CLI utilities for managing Agent Execution resources.
package execution

import (
	"fmt"
	"os"
	"time"

	"github.com/fatih/color"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

// DisplayGetResult displays an execution in the specified format.
// Supported formats: "table" (default), "yaml", "json".
func DisplayGetResult(exec *agentexecutionv1.AgentExecution, format string) {
	display.DisplayProto(exec, format, func() { displayExecutionTable(exec) })
}

// displayExecutionTable displays the execution in human-readable table format.
func displayExecutionTable(exec *agentexecutionv1.AgentExecution) {
	fmt.Println()
	fmt.Printf("Execution: %s\n", exec.GetMetadata().GetId())
	fmt.Println()

	fmt.Printf("Metadata:\n")
	fmt.Printf("  ID:      %s\n", exec.GetMetadata().GetId())
	fmt.Printf("  Name:    %s\n", exec.GetMetadata().GetName())
	fmt.Printf("  Org:     %s\n", exec.GetMetadata().GetOrg())
	fmt.Println()

	fmt.Printf("Spec:\n")
	fmt.Printf("  Agent ID:   %s\n", exec.GetSpec().GetAgentId())
	if exec.GetSpec().GetSessionId() != "" {
		fmt.Printf("  Session ID: %s\n", exec.GetSpec().GetSessionId())
	}
	if exec.GetSpec().GetMessage() != "" {
		fmt.Printf("  Message:    %s\n", display.TruncateWithEllipsis(exec.GetSpec().GetMessage(), 60))
	}
	fmt.Println()

	status := exec.GetStatus()
	fmt.Printf("Status:\n")
	fmt.Printf("  Phase:    %s\n", FormatPhase(status.GetPhase()))

	if status.GetStartedAt() != "" {
		fmt.Printf("  Started:  %s\n", formatTimestamp(status.GetStartedAt()))
	}
	if status.GetCompletedAt() != "" {
		fmt.Printf("  Completed: %s\n", formatTimestamp(status.GetCompletedAt()))
		fmt.Printf("  Duration:  %s\n", calculateDuration(status.GetStartedAt(), status.GetCompletedAt()))
	}

	if status.GetError() != "" {
		fmt.Println()
		fmt.Printf("Error: %s\n", status.GetError())
	}

	// Artifacts section
	artifacts := status.GetArtifacts()
	if len(artifacts) > 0 {
		fmt.Println()
		fmt.Printf("Artifacts:\n")
		fmt.Println()
		fmt.Printf("  %-30s  %-10s  %-10s  %s\n", "NAME", "SIZE", "KIND", "CREATED")
		fmt.Printf("  %-30s  %-10s  %-10s  %s\n", "----", "----", "----", "-------")
		for _, artifact := range artifacts {
			fmt.Printf("  %-30s  %-10s  %-10s  %s\n",
				display.TruncateWithEllipsis(artifact.GetName(), 30),
				formatBytes(artifact.GetSizeBytes()),
				formatArtifactKind(artifact.GetKind()),
				formatTimestamp(artifact.GetCreatedAt()),
			)
		}
	}

	// Messages section (show last few)
	messages := status.GetMessages()
	if len(messages) > 0 {
		fmt.Println()
		fmt.Printf("Recent Messages: (%d total)\n", len(messages))
		// Show last 3 messages
		start := len(messages) - 3
		if start < 0 {
			start = 0
		}
		for _, msg := range messages[start:] {
			msgType := formatMessageType(msg.GetType())
			content := display.TruncateWithEllipsis(msg.GetContent(), 80)
			fmt.Printf("  [%s] %s\n", msgType, content)
		}
	}

	fmt.Println()
}

// DisplayListResult displays a list of executions.
func DisplayListResult(list *agentexecutionv1.AgentExecutionList, format string) {
	entries := list.GetEntries()
	if len(entries) == 0 {
		display.DisplayEmptyResults("executions", "")
		return
	}

	display.DisplayProto(list, format, func() { displayListTable(list) })
}

// displayListTable displays executions in table format.
func displayListTable(list *agentexecutionv1.AgentExecutionList) {
	entries := list.GetEntries()
	headerColor := color.New(color.FgCyan, color.Bold).SprintFunc()

	tbl := display.NewTable(
		[]string{"ID", "AGENT", "STATUS", "STARTED", "DURATION"},
		display.WithHeaderColor(headerColor),
		display.WithAdaptive(),
	)

	for _, exec := range entries {
		duration := "-"
		if exec.GetStatus().GetCompletedAt() != "" {
			duration = calculateDuration(exec.GetStatus().GetStartedAt(), exec.GetStatus().GetCompletedAt())
		} else if exec.GetStatus().GetStartedAt() != "" {
			duration = calculateDuration(exec.GetStatus().GetStartedAt(), time.Now().Format(time.RFC3339))
		}

		tbl.AddRow(
			exec.GetMetadata().GetId(),
			exec.GetSpec().GetAgentId(),
			FormatPhase(exec.GetStatus().GetPhase()),
			formatTimestamp(exec.GetStatus().GetStartedAt()),
			duration,
		)
	}

	fmt.Println()
	tbl.Render(os.Stdout)

	totalPages := list.GetTotalPages()
	if totalPages > 1 {
		fmt.Printf("Page 1 of %d\n", totalPages)
	}
}

// FormatPhase formats an execution phase for display.
func FormatPhase(phase agentexecutionv1.ExecutionPhase) string {
	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_PENDING:
		return "pending"
	case agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS:
		return "running"
	case agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL:
		return "awaiting-approval"
	case agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED:
		return "paused"
	case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		return "completed"
	case agentexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		return "failed"
	case agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		return "cancelled"
	case agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED:
		return "terminated"
	default:
		return "unknown"
	}
}

// formatTimestamp formats an ISO 8601 timestamp for display.
func formatTimestamp(ts string) string {
	if ts == "" {
		return "-"
	}
	t, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		return ts
	}
	return t.Local().Format("2006-01-02 15:04:05")
}

// calculateDuration calculates the duration between two ISO 8601 timestamps.
func calculateDuration(start, end string) string {
	if start == "" || end == "" {
		return "-"
	}
	startTime, err := time.Parse(time.RFC3339, start)
	if err != nil {
		return "-"
	}
	endTime, err := time.Parse(time.RFC3339, end)
	if err != nil {
		return "-"
	}
	d := endTime.Sub(startTime)
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm %ds", int(d.Minutes()), int(d.Seconds())%60)
	}
	return fmt.Sprintf("%dh %dm", int(d.Hours()), int(d.Minutes())%60)
}

// formatBytes formats bytes as a human-readable string.
func formatBytes(bytes int64) string {
	const (
		KB = 1024
		MB = KB * 1024
		GB = MB * 1024
	)
	switch {
	case bytes >= GB:
		return fmt.Sprintf("%.1f GB", float64(bytes)/GB)
	case bytes >= MB:
		return fmt.Sprintf("%.1f MB", float64(bytes)/MB)
	case bytes >= KB:
		return fmt.Sprintf("%.1f KB", float64(bytes)/KB)
	default:
		return fmt.Sprintf("%d B", bytes)
	}
}

// formatArtifactKind formats an artifact kind for display.
func formatArtifactKind(kind agentexecutionv1.ExecutionArtifactKind) string {
	switch kind {
	case agentexecutionv1.ExecutionArtifactKind_EXECUTION_ARTIFACT_KIND_FILE:
		return "file"
	case agentexecutionv1.ExecutionArtifactKind_EXECUTION_ARTIFACT_KIND_DIRECTORY:
		return "directory"
	default:
		return "unknown"
	}
}

// formatMessageType formats a message type for display.
func formatMessageType(msgType agentexecutionv1.MessageType) string {
	switch msgType {
	case agentexecutionv1.MessageType_MESSAGE_HUMAN:
		return "HUMAN"
	case agentexecutionv1.MessageType_MESSAGE_AI:
		return "AI"
	case agentexecutionv1.MessageType_MESSAGE_TOOL:
		return "TOOL"
	case agentexecutionv1.MessageType_MESSAGE_SYSTEM:
		return "SYSTEM"
	default:
		return "UNKNOWN"
	}
}

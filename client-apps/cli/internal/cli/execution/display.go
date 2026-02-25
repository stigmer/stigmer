// Package execution provides CLI utilities for managing Agent Execution resources.
package execution

import (
	"fmt"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"google.golang.org/protobuf/encoding/protojson"
	"gopkg.in/yaml.v3"
)

// DisplayGetResult displays an execution in the specified format.
// Supported formats: "table" (default), "yaml", "json".
func DisplayGetResult(exec *agentexecutionv1.AgentExecution, format string) {
	switch format {
	case "yaml":
		displayExecutionYAML(exec)
	case "json":
		displayExecutionJSON(exec)
	default: // table
		displayExecutionTable(exec)
	}
}

// displayExecutionTable displays the execution in human-readable table format.
func displayExecutionTable(exec *agentexecutionv1.AgentExecution) {
	fmt.Println()
	cliprint.PrintInfo("Execution: %s", exec.GetMetadata().GetId())
	fmt.Println()

	// Metadata section
	cliprint.PrintInfo("Metadata:")
	cliprint.PrintInfo("  ID:      %s", exec.GetMetadata().GetId())
	cliprint.PrintInfo("  Name:    %s", exec.GetMetadata().GetName())
	cliprint.PrintInfo("  Org:     %s", exec.GetMetadata().GetOrg())
	fmt.Println()

	// Spec section
	cliprint.PrintInfo("Spec:")
	cliprint.PrintInfo("  Agent ID:   %s", exec.GetSpec().GetAgentId())
	if exec.GetSpec().GetSessionId() != "" {
		cliprint.PrintInfo("  Session ID: %s", exec.GetSpec().GetSessionId())
	}
	if exec.GetSpec().GetMessage() != "" {
		cliprint.PrintInfo("  Message:    %s", truncateString(exec.GetSpec().GetMessage(), 60))
	}
	fmt.Println()

	// Status section
	status := exec.GetStatus()
	cliprint.PrintInfo("Status:")
	cliprint.PrintInfo("  Phase:    %s", FormatPhase(status.GetPhase()))

	if status.GetStartedAt() != "" {
		cliprint.PrintInfo("  Started:  %s", formatTimestamp(status.GetStartedAt()))
	}
	if status.GetCompletedAt() != "" {
		cliprint.PrintInfo("  Completed: %s", formatTimestamp(status.GetCompletedAt()))
		cliprint.PrintInfo("  Duration:  %s", calculateDuration(status.GetStartedAt(), status.GetCompletedAt()))
	}

	if status.GetError() != "" {
		fmt.Println()
		cliprint.PrintError("Error: %s", status.GetError())
	}

	// Artifacts section
	artifacts := status.GetArtifacts()
	if len(artifacts) > 0 {
		fmt.Println()
		cliprint.PrintInfo("Artifacts:")
		fmt.Println()
		fmt.Printf("  %-30s  %-10s  %-10s  %s\n", "NAME", "SIZE", "KIND", "CREATED")
		fmt.Printf("  %-30s  %-10s  %-10s  %s\n", "----", "----", "----", "-------")
		for _, artifact := range artifacts {
			fmt.Printf("  %-30s  %-10s  %-10s  %s\n",
				truncateString(artifact.GetName(), 30),
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
		cliprint.PrintInfo("Recent Messages: (%d total)", len(messages))
		// Show last 3 messages
		start := len(messages) - 3
		if start < 0 {
			start = 0
		}
		for _, msg := range messages[start:] {
			msgType := formatMessageType(msg.GetType())
			content := truncateString(msg.GetContent(), 80)
			fmt.Printf("  [%s] %s\n", msgType, content)
		}
	}

	fmt.Println()
}

// displayExecutionYAML displays the execution as YAML.
func displayExecutionYAML(exec *agentexecutionv1.AgentExecution) {
	marshaler := protojson.MarshalOptions{
		Indent:          "  ",
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}
	jsonBytes, err := marshaler.Marshal(exec)
	if err != nil {
		clierr.Handle(fmt.Errorf("failed to marshal execution to JSON: %w", err))
		return
	}

	// Convert JSON to YAML via generic map
	var jsonMap map[string]interface{}
	if err := yaml.Unmarshal(jsonBytes, &jsonMap); err != nil {
		clierr.Handle(fmt.Errorf("failed to parse JSON: %w", err))
		return
	}

	yamlBytes, err := yaml.Marshal(jsonMap)
	if err != nil {
		clierr.Handle(fmt.Errorf("failed to marshal to YAML: %w", err))
		return
	}
	fmt.Print(string(yamlBytes))
}

// displayExecutionJSON displays the execution as JSON.
func displayExecutionJSON(exec *agentexecutionv1.AgentExecution) {
	marshaler := protojson.MarshalOptions{
		Indent:          "  ",
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}
	jsonBytes, err := marshaler.Marshal(exec)
	if err != nil {
		clierr.Handle(fmt.Errorf("failed to marshal execution to JSON: %w", err))
		return
	}
	fmt.Println(string(jsonBytes))
}

// DisplayListResult displays a list of executions.
func DisplayListResult(list *agentexecutionv1.AgentExecutionList, format string) {
	entries := list.GetEntries()
	if len(entries) == 0 {
		fmt.Println()
		cliprint.PrintInfo("No executions found.")
		fmt.Println()
		return
	}

	switch format {
	case "yaml":
		displayListYAML(list)
	case "json":
		displayListJSON(list)
	default: // table
		displayListTable(list)
	}
}

// displayListTable displays executions in table format.
func displayListTable(list *agentexecutionv1.AgentExecutionList) {
	entries := list.GetEntries()

	fmt.Println()
	fmt.Printf("%-26s  %-26s  %-15s  %-20s  %s\n", "ID", "AGENT", "STATUS", "STARTED", "DURATION")
	fmt.Printf("%-26s  %-26s  %-15s  %-20s  %s\n", "--", "-----", "------", "-------", "--------")

	for _, exec := range entries {
		id := exec.GetMetadata().GetId()
		agentID := truncateString(exec.GetSpec().GetAgentId(), 26)
		status := FormatPhase(exec.GetStatus().GetPhase())
		started := formatTimestamp(exec.GetStatus().GetStartedAt())
		duration := "-"
		if exec.GetStatus().GetCompletedAt() != "" {
			duration = calculateDuration(exec.GetStatus().GetStartedAt(), exec.GetStatus().GetCompletedAt())
		} else if exec.GetStatus().GetStartedAt() != "" {
			duration = calculateDuration(exec.GetStatus().GetStartedAt(), time.Now().Format(time.RFC3339))
		}

		fmt.Printf("%-26s  %-26s  %-15s  %-20s  %s\n", id, agentID, status, started, duration)
	}

	fmt.Println()
	totalPages := list.GetTotalPages()
	if totalPages > 1 {
		cliprint.PrintInfo("Page 1 of %d", totalPages)
	}
}

// displayListYAML displays the list as YAML.
func displayListYAML(list *agentexecutionv1.AgentExecutionList) {
	marshaler := protojson.MarshalOptions{
		Indent:          "  ",
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}
	jsonBytes, err := marshaler.Marshal(list)
	if err != nil {
		clierr.Handle(fmt.Errorf("failed to marshal list to JSON: %w", err))
		return
	}

	var jsonMap map[string]interface{}
	if err := yaml.Unmarshal(jsonBytes, &jsonMap); err != nil {
		clierr.Handle(fmt.Errorf("failed to parse JSON: %w", err))
		return
	}

	yamlBytes, err := yaml.Marshal(jsonMap)
	if err != nil {
		clierr.Handle(fmt.Errorf("failed to marshal to YAML: %w", err))
		return
	}
	fmt.Print(string(yamlBytes))
}

// displayListJSON displays the list as JSON.
func displayListJSON(list *agentexecutionv1.AgentExecutionList) {
	marshaler := protojson.MarshalOptions{
		Indent:          "  ",
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}
	jsonBytes, err := marshaler.Marshal(list)
	if err != nil {
		clierr.Handle(fmt.Errorf("failed to marshal list to JSON: %w", err))
		return
	}
	fmt.Println(string(jsonBytes))
}

// truncateString truncates a string to maxLen characters, adding "..." if truncated.
func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return "..."
	}
	return s[:maxLen-3] + "..."
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

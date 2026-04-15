package root

import (
	"strings"
	"testing"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

// =============================================================================
// displayPendingApproval Tests
// =============================================================================

func TestDisplayPendingApproval_BasicFields(t *testing.T) {
	pa := &agentexecutionv1.PendingApproval{
		ToolName: "write_file",
		Message:  "Write to protected file: /etc/hosts",
	}

	output := captureStdout(t, func() {
		displayPendingApproval(pa)
	})

	// Verify tool name is displayed
	if !strings.Contains(output, "write_file") {
		t.Errorf("expected output to contain tool name 'write_file', got: %s", output)
	}

	// Verify message is displayed
	if !strings.Contains(output, "Message: Write to protected file: /etc/hosts") {
		t.Errorf("expected output to contain message, got: %s", output)
	}

	// Verify panel border is present
	if !strings.Contains(output, "╭") || !strings.Contains(output, "╯") {
		t.Errorf("expected output to contain panel border characters, got: %s", output)
	}

	// Verify title is present
	if !strings.Contains(output, "APPROVAL REQUIRED") {
		t.Errorf("expected output to contain 'APPROVAL REQUIRED' title, got: %s", output)
	}
}

func TestDisplayPendingApproval_WithSubAgent(t *testing.T) {
	pa := &agentexecutionv1.PendingApproval{
		ToolName:     "execute_sql",
		Message:      "Execute SQL query",
		FromSubAgent: true,
		SubAgentName: "code-reviewer",
	}

	output := captureStdout(t, func() {
		displayPendingApproval(pa)
	})

	// Verify sub-agent info is shown with new format
	if !strings.Contains(output, "code-reviewer") {
		t.Errorf("expected output to contain sub-agent name, got: %s", output)
	}
	if !strings.Contains(output, "sub-agent") {
		t.Errorf("expected output to contain 'sub-agent' indicator, got: %s", output)
	}
}

func TestDisplayPendingApproval_SubAgentNotShownWhenFalse(t *testing.T) {
	pa := &agentexecutionv1.PendingApproval{
		ToolName:     "execute_sql",
		Message:      "Execute SQL query",
		FromSubAgent: false,
		SubAgentName: "should-not-show",
	}

	output := captureStdout(t, func() {
		displayPendingApproval(pa)
	})

	// Verify sub-agent line is NOT shown when FromSubAgent is false
	if strings.Contains(output, "should-not-show") {
		t.Errorf("expected output NOT to contain sub-agent name when FromSubAgent=false, got: %s", output)
	}
	if strings.Contains(output, "From:") {
		t.Errorf("expected output NOT to contain 'From:' when FromSubAgent=false, got: %s", output)
	}
}

func TestDisplayPendingApproval_WithArgsPreview(t *testing.T) {
	argsJSON := `{"path": "/etc/hosts", "content": "127.0.0.1 localhost"}`
	pa := &agentexecutionv1.PendingApproval{
		ToolName:    "write_file",
		ArgsPreview: argsJSON,
	}

	output := captureStdout(t, func() {
		displayPendingApproval(pa)
	})

	// Verify Arguments header is present
	if !strings.Contains(output, "Arguments:") {
		t.Errorf("expected output to contain 'Arguments:', got: %s", output)
	}

	// Verify args content is formatted by the formatter
	if !strings.Contains(output, "Path:") {
		t.Errorf("expected output to contain formatted 'Path:' label for write_file tool, got: %s", output)
	}
	if !strings.Contains(output, "/etc/hosts") {
		t.Errorf("expected output to contain path value, got: %s", output)
	}
}

func TestDisplayPendingApproval_NoArgsPreview(t *testing.T) {
	pa := &agentexecutionv1.PendingApproval{
		ToolName:    "read_file",
		Message:     "Read file",
		ArgsPreview: "",
	}

	output := captureStdout(t, func() {
		displayPendingApproval(pa)
	})

	// Verify Arguments section is NOT present when empty
	if strings.Contains(output, "Arguments:") {
		t.Errorf("expected output NOT to contain 'Arguments:' when ArgsPreview is empty, got: %s", output)
	}
}

func TestDisplayPendingApproval_NilApproval(t *testing.T) {
	output := captureStdout(t, func() {
		displayPendingApproval(nil)
	})

	// Verify nothing is printed for nil approval
	if output != "" {
		t.Errorf("expected empty output for nil approval, got: %s", output)
	}
}

func TestDisplayPendingApproval_FormatsWaitingDuration(t *testing.T) {
	// Use a timestamp from 30 seconds ago
	requestedAt := time.Now().Add(-30 * time.Second).Format(time.RFC3339)
	pa := &agentexecutionv1.PendingApproval{
		ToolName:    "delete_file",
		Message:     "Delete important file",
		RequestedAt: requestedAt,
	}

	output := captureStdout(t, func() {
		displayPendingApproval(pa)
	})

	// Verify waiting duration is displayed
	if !strings.Contains(output, "Waiting for:") {
		t.Errorf("expected output to contain 'Waiting for:', got: %s", output)
	}

	// Verify it shows seconds
	if !strings.Contains(output, "s") {
		t.Errorf("expected output to contain duration with seconds, got: %s", output)
	}
}

func TestDisplayPendingApproval_EmptyMessage(t *testing.T) {
	pa := &agentexecutionv1.PendingApproval{
		ToolName: "some_tool",
		Message:  "",
	}

	output := captureStdout(t, func() {
		displayPendingApproval(pa)
	})

	// Verify Message line is NOT present when empty
	if strings.Contains(output, "Message:") {
		t.Errorf("expected output NOT to contain 'Message:' when message is empty, got: %s", output)
	}

	// Tool should still be shown
	if !strings.Contains(output, "some_tool") {
		t.Errorf("expected output to contain tool name, got: %s", output)
	}
}

// =============================================================================
// formatWaitingDuration Tests
// =============================================================================

func TestFormatWaitingDuration_EmptyString(t *testing.T) {
	result := formatWaitingDuration("")
	if result != "unknown" {
		t.Errorf("expected 'unknown' for empty string, got: %s", result)
	}
}

func TestFormatWaitingDuration_InvalidTimestamp(t *testing.T) {
	result := formatWaitingDuration("not-a-valid-timestamp")
	if result != "unknown" {
		t.Errorf("expected 'unknown' for invalid timestamp, got: %s", result)
	}
}

func TestFormatWaitingDuration_JustNow(t *testing.T) {
	// Use current time (less than 1 second ago)
	requestedAt := time.Now().Format(time.RFC3339)
	result := formatWaitingDuration(requestedAt)
	if result != "just now" {
		t.Errorf("expected 'just now' for recent timestamp, got: %s", result)
	}
}

func TestFormatWaitingDuration_Seconds(t *testing.T) {
	// 5 seconds ago
	requestedAt := time.Now().Add(-5 * time.Second).Format(time.RFC3339)
	result := formatWaitingDuration(requestedAt)

	// Should be around "5s" (might be 5s or 6s due to test execution time)
	if !strings.HasSuffix(result, "s") {
		t.Errorf("expected duration ending in 's', got: %s", result)
	}
}

func TestFormatWaitingDuration_Minutes(t *testing.T) {
	// 2 minutes and 30 seconds ago
	requestedAt := time.Now().Add(-150 * time.Second).Format(time.RFC3339)
	result := formatWaitingDuration(requestedAt)

	// Should contain minutes
	if !strings.Contains(result, "m") {
		t.Errorf("expected duration containing 'm' for minutes, got: %s", result)
	}
}

func TestFormatWaitingDuration_Various(t *testing.T) {
	tests := []struct {
		name        string
		offset      time.Duration
		expectPart  string
		description string
	}{
		{
			name:        "10 seconds",
			offset:      -10 * time.Second,
			expectPart:  "s",
			description: "should contain seconds",
		},
		{
			name:        "1 minute",
			offset:      -60 * time.Second,
			expectPart:  "m",
			description: "should contain minutes",
		},
		{
			name:        "1 hour",
			offset:      -3600 * time.Second,
			expectPart:  "h",
			description: "should contain hours",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			requestedAt := time.Now().Add(tt.offset).Format(time.RFC3339)
			result := formatWaitingDuration(requestedAt)

			if !strings.Contains(result, tt.expectPart) {
				t.Errorf("%s: expected result to contain '%s', got: %s", tt.description, tt.expectPart, result)
			}
		})
	}
}

// =============================================================================
// parseTimestamp Tests
// =============================================================================

func TestParseTimestamp_RFC3339(t *testing.T) {
	ts := "2026-02-14T15:30:00Z"
	parsed, err := parseTimestamp(ts)
	if err != nil {
		t.Fatalf("expected successful parse of RFC3339, got error: %v", err)
	}
	if parsed.Year() != 2026 || parsed.Month() != 2 || parsed.Day() != 14 {
		t.Errorf("unexpected parsed date: %v", parsed)
	}
}

func TestParseTimestamp_RFC3339Nano(t *testing.T) {
	ts := "2026-02-14T15:30:00.123456789Z"
	_, err := parseTimestamp(ts)
	if err != nil {
		t.Fatalf("expected successful parse of RFC3339Nano, got error: %v", err)
	}
}

func TestParseTimestamp_BareISO8601WithMicroseconds(t *testing.T) {
	// This is what Python's datetime.utcnow().isoformat() produces
	ts := "2026-02-14T15:30:00.123456"
	parsed, err := parseTimestamp(ts)
	if err != nil {
		t.Fatalf("expected successful parse of bare ISO 8601 with microseconds, got error: %v", err)
	}
	if parsed.Year() != 2026 || parsed.Month() != 2 || parsed.Day() != 14 {
		t.Errorf("unexpected parsed date: %v", parsed)
	}
}

func TestParseTimestamp_BareISO8601NoFraction(t *testing.T) {
	ts := "2026-02-14T15:30:00"
	_, err := parseTimestamp(ts)
	if err != nil {
		t.Fatalf("expected successful parse of bare ISO 8601 (no fraction), got error: %v", err)
	}
}

func TestParseTimestamp_Invalid(t *testing.T) {
	_, err := parseTimestamp("not-a-timestamp")
	if err == nil {
		t.Fatal("expected error for invalid timestamp, got nil")
	}
}

func TestFormatWaitingDuration_BareISO8601(t *testing.T) {
	// Simulate a timestamp 10 seconds ago without timezone suffix
	// (as Python's datetime.utcnow().isoformat() would produce)
	ts := time.Now().UTC().Add(-10 * time.Second).Format("2006-01-02T15:04:05.999999")
	result := formatWaitingDuration(ts)

	// Should parse successfully and return a duration, not "unknown"
	if result == "unknown" {
		t.Errorf("expected valid duration for bare ISO 8601 timestamp, got 'unknown'")
	}
	if !strings.Contains(result, "s") {
		t.Errorf("expected duration containing seconds, got: %s", result)
	}
}

// =============================================================================
// buildApprovalContent Tests
// =============================================================================

func TestBuildApprovalContent_AllSections(t *testing.T) {
	pa := &agentexecutionv1.PendingApproval{
		ToolName:     "delete_file",
		Message:      "Delete staging file",
		FromSubAgent: true,
		SubAgentName: "cleanup-agent",
		RequestedAt:  time.Now().Add(-10 * time.Second).Format(time.RFC3339),
	}

	content := buildApprovalContent(pa)

	// All simultaneously-visible sections should be present
	// (Message and Arguments are mutually exclusive; Message takes priority)
	if !strings.Contains(content, "delete_file") {
		t.Error("expected tool name in content")
	}
	if !strings.Contains(content, "cleanup-agent") {
		t.Error("expected sub-agent name in content")
	}
	if !strings.Contains(content, "Delete staging file") {
		t.Error("expected message in content")
	}
	if !strings.Contains(content, "Waiting for:") {
		t.Error("expected waiting duration in content")
	}
}

func TestBuildApprovalContent_MinimalFields(t *testing.T) {
	pa := &agentexecutionv1.PendingApproval{
		ToolName: "read_file",
	}

	content := buildApprovalContent(pa)

	// Tool name and waiting duration should always be present
	if !strings.Contains(content, "read_file") {
		t.Error("expected tool name in content")
	}
	if !strings.Contains(content, "Waiting for:") {
		t.Error("expected waiting duration in content")
	}

	// Optional sections should NOT be present
	if strings.Contains(content, "Message:") {
		t.Error("expected no Message section for empty message")
	}
	if strings.Contains(content, "Arguments:") {
		t.Error("expected no Arguments section for empty args")
	}
	if strings.Contains(content, "From:") {
		t.Error("expected no From section when not from sub-agent")
	}
}

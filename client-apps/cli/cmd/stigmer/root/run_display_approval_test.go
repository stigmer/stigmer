package root

import (
	"bytes"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// =============================================================================
// Test Helpers
// =============================================================================

// captureStdout captures stdout during the execution of f and returns the output.
func captureStdout(t *testing.T, f func()) string {
	t.Helper()

	oldStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("failed to create pipe: %v", err)
	}
	os.Stdout = w

	f()

	w.Close()
	os.Stdout = oldStdout

	var buf bytes.Buffer
	if _, err := io.Copy(&buf, r); err != nil {
		t.Fatalf("failed to read captured output: %v", err)
	}

	return buf.String()
}

// =============================================================================
// displayPendingApproval Tests
// =============================================================================

func TestDisplayPendingApproval_BasicFields(t *testing.T) {
	approval := &agentexecutionv1.PendingApproval{
		ToolName: "write_file",
		Message:  "Write to protected file: /etc/hosts",
	}

	output := captureStdout(t, func() {
		displayPendingApproval(approval)
	})

	// Verify tool name is displayed
	if !strings.Contains(output, "Tool: write_file") {
		t.Errorf("expected output to contain 'Tool: write_file', got: %s", output)
	}

	// Verify message is displayed
	if !strings.Contains(output, "Message: Write to protected file: /etc/hosts") {
		t.Errorf("expected output to contain message, got: %s", output)
	}

	// Verify separators are present (fmt.Println output)
	if !strings.Contains(output, "─") {
		t.Errorf("expected output to contain separator, got: %s", output)
	}
}

func TestDisplayPendingApproval_WithSubAgent(t *testing.T) {
	approval := &agentexecutionv1.PendingApproval{
		ToolName:     "execute_sql",
		Message:      "Execute SQL query",
		FromSubAgent: true,
		SubAgentName: "code-reviewer",
	}

	output := captureStdout(t, func() {
		displayPendingApproval(approval)
	})

	// Verify sub-agent name is shown
	if !strings.Contains(output, "Sub-agent: code-reviewer") {
		t.Errorf("expected output to contain sub-agent name, got: %s", output)
	}
}

func TestDisplayPendingApproval_SubAgentNotShownWhenFalse(t *testing.T) {
	approval := &agentexecutionv1.PendingApproval{
		ToolName:     "execute_sql",
		Message:      "Execute SQL query",
		FromSubAgent: false,
		SubAgentName: "should-not-show",
	}

	output := captureStdout(t, func() {
		displayPendingApproval(approval)
	})

	// Verify sub-agent line is NOT shown when FromSubAgent is false
	if strings.Contains(output, "Sub-agent:") {
		t.Errorf("expected output NOT to contain Sub-agent line when FromSubAgent=false, got: %s", output)
	}
}

func TestDisplayPendingApproval_WithArgsPreview(t *testing.T) {
	argsJSON := `{
  "path": "/etc/hosts",
  "content": "127.0.0.1 localhost"
}`
	approval := &agentexecutionv1.PendingApproval{
		ToolName:    "write_file",
		Message:     "Write file",
		ArgsPreview: argsJSON,
	}

	output := captureStdout(t, func() {
		displayPendingApproval(approval)
	})

	// Verify Arguments header is present
	if !strings.Contains(output, "Arguments:") {
		t.Errorf("expected output to contain 'Arguments:', got: %s", output)
	}

	// Verify args content is present (indented)
	if !strings.Contains(output, "path") || !strings.Contains(output, "/etc/hosts") {
		t.Errorf("expected output to contain args preview content, got: %s", output)
	}
}

func TestDisplayPendingApproval_NoArgsPreview(t *testing.T) {
	approval := &agentexecutionv1.PendingApproval{
		ToolName:    "read_file",
		Message:     "Read file",
		ArgsPreview: "",
	}

	output := captureStdout(t, func() {
		displayPendingApproval(approval)
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
	approval := &agentexecutionv1.PendingApproval{
		ToolName:    "delete_file",
		Message:     "Delete important file",
		RequestedAt: requestedAt,
	}

	output := captureStdout(t, func() {
		displayPendingApproval(approval)
	})

	// Verify waiting duration is displayed
	if !strings.Contains(output, "Waiting for:") {
		t.Errorf("expected output to contain 'Waiting for:', got: %s", output)
	}

	// Verify it shows seconds (approximate, since time passes)
	if !strings.Contains(output, "s") {
		t.Errorf("expected output to contain duration with seconds, got: %s", output)
	}
}

func TestDisplayPendingApproval_EmptyMessage(t *testing.T) {
	approval := &agentexecutionv1.PendingApproval{
		ToolName: "some_tool",
		Message:  "",
	}

	output := captureStdout(t, func() {
		displayPendingApproval(approval)
	})

	// Verify Message line is NOT present when empty
	if strings.Contains(output, "Message:") {
		t.Errorf("expected output NOT to contain 'Message:' when message is empty, got: %s", output)
	}

	// Tool should still be shown
	if !strings.Contains(output, "Tool: some_tool") {
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
// formatApprovalArgsPreview Tests
// =============================================================================

func TestFormatApprovalArgsPreview_EmptyString(t *testing.T) {
	result := formatApprovalArgsPreview("")
	if result != "" {
		t.Errorf("expected empty string for empty input, got: %s", result)
	}
}

func TestFormatApprovalArgsPreview_SingleLine(t *testing.T) {
	result := formatApprovalArgsPreview(`{"key": "value"}`)

	// Should have indent prefix
	if !strings.HasPrefix(result, "      ") {
		t.Errorf("expected result to start with indent, got: %s", result)
	}

	// Should contain the content
	if !strings.Contains(result, `"key": "value"`) {
		t.Errorf("expected result to contain the JSON content, got: %s", result)
	}

	// Should end with newline
	if !strings.HasSuffix(result, "\n") {
		t.Errorf("expected result to end with newline, got: %s", result)
	}
}

func TestFormatApprovalArgsPreview_MultilineJSON(t *testing.T) {
	input := `{
  "path": "/etc/hosts",
  "content": "test"
}`
	result := formatApprovalArgsPreview(input)

	// Count lines
	lines := strings.Split(strings.TrimSuffix(result, "\n"), "\n")
	if len(lines) != 4 {
		t.Errorf("expected 4 lines, got %d: %v", len(lines), lines)
	}

	// Each line should be indented
	for i, line := range lines {
		if !strings.HasPrefix(line, "      ") {
			t.Errorf("line %d should be indented, got: %s", i, line)
		}
	}
}

func TestFormatApprovalArgsPreview_PreservesContent(t *testing.T) {
	input := `{"special": "chars: <>\"'&"}`
	result := formatApprovalArgsPreview(input)

	// Should preserve special characters
	if !strings.Contains(result, `chars: <>\"'&`) {
		t.Errorf("expected special characters to be preserved, got: %s", result)
	}
}

func TestFormatApprovalArgsPreview_HandlesEmptyLines(t *testing.T) {
	input := "line1\n\nline3"
	result := formatApprovalArgsPreview(input)

	// Should have 3 lines, including the empty one (indented)
	lines := strings.Split(strings.TrimSuffix(result, "\n"), "\n")
	if len(lines) != 3 {
		t.Errorf("expected 3 lines, got %d: %v", len(lines), lines)
	}

	// Empty line should just be indent
	if lines[1] != "      " {
		t.Errorf("empty line should be just indent, got: '%s'", lines[1])
	}
}

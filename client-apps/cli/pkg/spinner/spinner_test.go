package spinner

import (
	"bytes"
	"testing"
	"time"
)

// =============================================================================
// formatElapsed Tests
// =============================================================================

func TestFormatElapsed_SubSecond(t *testing.T) {
	result := formatElapsed(500 * time.Millisecond)
	if result != "" {
		t.Errorf("expected empty string for <1s, got %q", result)
	}
}

func TestFormatElapsed_Seconds(t *testing.T) {
	tests := []struct {
		duration time.Duration
		expected string
	}{
		{1 * time.Second, "(1s)"},
		{5 * time.Second, "(5s)"},
		{30 * time.Second, "(30s)"},
		{59 * time.Second, "(59s)"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			if got := formatElapsed(tt.duration); got != tt.expected {
				t.Errorf("formatElapsed(%v) = %q, want %q", tt.duration, got, tt.expected)
			}
		})
	}
}

func TestFormatElapsed_Minutes(t *testing.T) {
	tests := []struct {
		duration time.Duration
		expected string
	}{
		{60 * time.Second, "(1m0s)"},
		{90 * time.Second, "(1m30s)"},
		{150 * time.Second, "(2m30s)"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			if got := formatElapsed(tt.duration); got != tt.expected {
				t.Errorf("formatElapsed(%v) = %q, want %q", tt.duration, got, tt.expected)
			}
		})
	}
}

// =============================================================================
// Spinner Lifecycle Tests
// =============================================================================

func TestNew_ReturnsSpinner(t *testing.T) {
	var buf bytes.Buffer
	s := New(&buf)
	if s == nil {
		t.Fatal("New returned nil")
	}
	if s.IsActive() {
		t.Error("new spinner should not be active")
	}
}

func TestSpinner_StopWhenNotActive(t *testing.T) {
	var buf bytes.Buffer
	s := New(&buf)

	// Stop on an inactive spinner should be a no-op (no panic)
	s.Stop()

	if buf.Len() > 0 {
		t.Error("stop on inactive spinner should produce no output")
	}
}

func TestSpinner_IsActive(t *testing.T) {
	var buf bytes.Buffer
	s := New(&buf)

	if s.IsActive() {
		t.Error("expected inactive before start")
	}

	// Note: Start is a no-op in non-TTY (test) environments,
	// so IsActive will remain false. This is correct behavior.
	s.Start("test")

	// In a test environment (non-TTY), the spinner should NOT activate
	if s.IsActive() {
		t.Error("expected inactive in non-TTY environment")
	}
}

func TestSpinner_UpdateWhenInactive(t *testing.T) {
	var buf bytes.Buffer
	s := New(&buf)

	// Update on inactive spinner should be a no-op (no panic)
	s.Update("new label")

	if buf.Len() > 0 {
		t.Error("update on inactive spinner should produce no output")
	}
}

// =============================================================================
// renderFrame Tests (unit test the output format)
// =============================================================================

func TestRenderFrame_WithLabel(t *testing.T) {
	var buf bytes.Buffer
	s := New(&buf)

	s.renderFrame("⠋", "Working...", 0)

	output := buf.String()
	if output == "" {
		t.Fatal("expected non-empty output")
	}

	// Should start with carriage return
	if output[0] != '\r' {
		t.Error("expected output to start with \\r")
	}

	// Should contain the frame character
	if !containsStr(output, "⠋") {
		t.Error("expected output to contain spinner frame")
	}

	// Should contain the label
	if !containsStr(output, "Working...") {
		t.Error("expected output to contain label")
	}
}

func TestRenderFrame_WithElapsedTime(t *testing.T) {
	var buf bytes.Buffer
	s := New(&buf)

	s.renderFrame("⠹", "Loading...", 5*time.Second)

	output := buf.String()
	if !containsStr(output, "(5s)") {
		t.Errorf("expected elapsed time in output, got %q", output)
	}
}

func TestRenderFrame_NoElapsedForSubSecond(t *testing.T) {
	var buf bytes.Buffer
	s := New(&buf)

	s.renderFrame("⠋", "Starting", 200*time.Millisecond)

	output := buf.String()
	// Should not contain parenthesized time
	if containsStr(output, "(") {
		t.Errorf("expected no elapsed time for <1s, got %q", output)
	}
}

// =============================================================================
// clearLine Tests
// =============================================================================

func TestClearLine(t *testing.T) {
	var buf bytes.Buffer
	s := New(&buf)

	s.clearLine()

	output := buf.String()
	expected := "\r\033[K"
	if output != expected {
		t.Errorf("clearLine() = %q, want %q", output, expected)
	}
}

// =============================================================================
// frames Tests
// =============================================================================

func TestFrames_NotEmpty(t *testing.T) {
	if len(frames) == 0 {
		t.Fatal("frames slice must not be empty")
	}
}

func TestFrames_AllNonEmpty(t *testing.T) {
	for i, f := range frames {
		if f == "" {
			t.Errorf("frame[%d] is empty", i)
		}
	}
}

// =============================================================================
// Test Helpers
// =============================================================================

func containsStr(s, substr string) bool {
	return bytes.Contains([]byte(s), []byte(substr))
}

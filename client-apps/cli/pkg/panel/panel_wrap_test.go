package panel

import (
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
)

// =============================================================================
// wrapLine Tests
// =============================================================================

func TestWrapLine_ShortLine(t *testing.T) {
	lines := wrapLine("hello world", 40)
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
	if lines[0] != "hello world" {
		t.Errorf("expected %q, got %q", "hello world", lines[0])
	}
}

func TestWrapLine_EmptyLine(t *testing.T) {
	lines := wrapLine("", 40)
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
	if lines[0] != "" {
		t.Errorf("expected empty string, got %q", lines[0])
	}
}

func TestWrapLine_ExactWidth(t *testing.T) {
	text := strings.Repeat("a", 20)
	lines := wrapLine(text, 20)
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
}

func TestWrapLine_WordWrap(t *testing.T) {
	text := "command: cd /workspace && python /bin/skills/init_skill.py agent-drafter"
	lines := wrapLine(text, 40)

	if len(lines) < 2 {
		t.Fatalf("expected at least 2 lines for a 72-char line in 40-col width, got %d", len(lines))
	}

	// Each line should fit within the width
	for i, line := range lines {
		w := lipgloss.Width(line)
		if w > 40 {
			t.Errorf("line %d has visual width %d, exceeds limit 40: %q", i, w, line)
		}
	}
}

func TestWrapLine_LongWordHardBreak(t *testing.T) {
	// A single "word" with no spaces that exceeds maxWidth
	longWord := strings.Repeat("x", 60)
	lines := wrapLine(longWord, 30)

	if len(lines) < 2 {
		t.Fatalf("expected at least 2 lines for 60-char word in 30-col width, got %d", len(lines))
	}

	for i, line := range lines {
		w := lipgloss.Width(line)
		if w > 30 {
			t.Errorf("line %d has visual width %d, exceeds limit 30", i, w)
		}
	}
}

func TestWrapLine_ZeroWidth(t *testing.T) {
	lines := wrapLine("hello", 0)
	if len(lines) != 1 {
		t.Fatalf("expected 1 line for zero width, got %d", len(lines))
	}
}

// =============================================================================
// Render Integration: Wrapping
// =============================================================================

func TestRender_LongContentWraps(t *testing.T) {
	// Simulate a long command like the one in the approval panel
	longCommand := "command: cd /workspace && python /bin/skills/a34ed6ddb7e2b131cc2cb908c89c50c563405884c884d0ccd4752cc8a60079d/scripts/init_skill.py agent-drafter --path /workspace"
	content := "Tool: execute\n\nArguments:\n" + longCommand

	result := Render(content, Options{
		Title: "APPROVAL REQUIRED",
		Width: 80,
	})

	lines := strings.Split(result, "\n")

	// Every line should have the same visual width (wrapping keeps content
	// within the panel borders)
	expectedWidth := lipgloss.Width(lines[0])
	for i, line := range lines {
		w := lipgloss.Width(line)
		if w != expectedWidth {
			t.Errorf("line %d has visual width %d, expected %d: %q", i, w, expectedWidth, line)
		}
	}
}

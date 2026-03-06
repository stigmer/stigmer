package panel

import (
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
)

// =============================================================================
// Render Tests
// =============================================================================

func TestRender_EmptyContent(t *testing.T) {
	result := Render("", Options{Width: 30})
	lines := strings.Split(result, "\n")

	// Expected: top border, blank row, content (1 empty line), blank row, bottom border = 5 lines
	if len(lines) < 5 {
		t.Fatalf("expected at least 5 lines, got %d", len(lines))
	}

	assertContains(t, lines[0], "╭", "top border left corner")
	assertContains(t, lines[0], "╮", "top border right corner")
	assertContains(t, lines[len(lines)-1], "╰", "bottom border left corner")
	assertContains(t, lines[len(lines)-1], "╯", "bottom border right corner")
}

func TestRender_WithTitle(t *testing.T) {
	result := Render("hello", Options{
		Title: "TEST TITLE",
		Width: 40,
	})

	lines := strings.Split(result, "\n")
	assertContains(t, lines[0], "TEST TITLE", "title in top border")
}

func TestRender_WithoutTitle(t *testing.T) {
	result := Render("hello", Options{Width: 40})

	lines := strings.Split(result, "\n")
	assertContains(t, lines[0], "╭", "top border left corner")
	assertContains(t, lines[0], "╮", "top border right corner")
	// Top border should be all dashes (no title text)
	assertNotContains(t, lines[0], "hello", "top border should not contain content")
}

func TestRender_MultiLineContent(t *testing.T) {
	content := "line one\nline two\nline three"
	result := Render(content, Options{Width: 40})

	assertContains(t, result, "line one", "first line present")
	assertContains(t, result, "line two", "second line present")
	assertContains(t, result, "line three", "third line present")
}

func TestRender_ContentPresent(t *testing.T) {
	result := Render("important data", Options{Width: 40})
	assertContains(t, result, "important data", "content present in output")
}

func TestRender_ConsistentVisualWidth(t *testing.T) {
	result := Render("test", Options{Width: 30})
	lines := strings.Split(result, "\n")

	// All lines should have the same visual width when content fits
	expectedWidth := lipgloss.Width(lines[0])
	for i, line := range lines {
		w := lipgloss.Width(line)
		if w != expectedWidth {
			t.Errorf("line %d has visual width %d, expected %d", i, w, expectedWidth)
		}
	}
}

func TestRender_DefaultWidth(t *testing.T) {
	result := Render("test", Options{})
	lines := strings.Split(result, "\n")

	actualWidth := lipgloss.Width(lines[0])
	if actualWidth != DefaultWidth {
		t.Errorf("expected default width %d, got %d", DefaultWidth, actualWidth)
	}
}

func TestRender_CustomWidth(t *testing.T) {
	result := Render("test", Options{Width: 50})
	lines := strings.Split(result, "\n")

	actualWidth := lipgloss.Width(lines[0])
	if actualWidth != 50 {
		t.Errorf("expected width 50, got %d", actualWidth)
	}
}

func TestRender_ZeroWidthUsesDefault(t *testing.T) {
	result := Render("test", Options{Width: 0})
	lines := strings.Split(result, "\n")

	actualWidth := lipgloss.Width(lines[0])
	if actualWidth != DefaultWidth {
		t.Errorf("expected default width %d for zero width, got %d", DefaultWidth, actualWidth)
	}
}

func TestRender_NegativeWidthUsesDefault(t *testing.T) {
	result := Render("test", Options{Width: -10})
	lines := strings.Split(result, "\n")

	actualWidth := lipgloss.Width(lines[0])
	if actualWidth != DefaultWidth {
		t.Errorf("expected default width %d for negative width, got %d", DefaultWidth, actualWidth)
	}
}

// =============================================================================
// Panel Style Tests
// =============================================================================

func TestRender_DifferentStyles(t *testing.T) {
	styles := []PanelStyle{StyleDefault, StyleWarning, StyleError, StyleSuccess}

	for _, style := range styles {
		t.Run(style.String(), func(t *testing.T) {
			// Verify rendering doesn't panic for any style
			result := Render("content", Options{Style: style, Width: 30})
			if result == "" {
				t.Error("expected non-empty output")
			}
		})
	}
}

// =============================================================================
// renderTopBorder Tests
// =============================================================================

func TestRenderTopBorder_WithTitle(t *testing.T) {
	border := lipgloss.NewStyle()
	title := lipgloss.NewStyle().Bold(true)

	result := renderTopBorder("TITLE", 30, border, title)

	assertContains(t, result, "╭", "left corner")
	assertContains(t, result, "╮", "right corner")
	assertContains(t, result, "TITLE", "title text")
}

func TestRenderTopBorder_WithoutTitle(t *testing.T) {
	border := lipgloss.NewStyle()
	title := lipgloss.NewStyle().Bold(true)

	result := renderTopBorder("", 30, border, title)

	assertContains(t, result, "╭", "left corner")
	assertContains(t, result, "╮", "right corner")

	// Should be all dashes between corners
	visualWidth := lipgloss.Width(result)
	if visualWidth != 32 { // 30 inner + 2 corners
		t.Errorf("expected visual width 32, got %d", visualWidth)
	}
}

// =============================================================================
// resolveColor Tests
// =============================================================================

func TestResolveColor_AllStyles(t *testing.T) {
	// Verify each style resolves to a non-nil color
	styles := []PanelStyle{StyleDefault, StyleWarning, StyleError, StyleSuccess}
	for _, style := range styles {
		color := ResolveColor(style)
		if color == nil {
			t.Errorf("ResolveColor(%d) returned nil", style)
		}
	}
}

// =============================================================================
// PanelStyle String helper (for test names)
// =============================================================================

func (s PanelStyle) String() string {
	switch s {
	case StyleWarning:
		return "warning"
	case StyleError:
		return "error"
	case StyleSuccess:
		return "success"
	default:
		return "default"
	}
}

// =============================================================================
// Test Helpers
// =============================================================================

func assertContains(t *testing.T, s, substr, description string) {
	t.Helper()
	if !strings.Contains(s, substr) {
		t.Errorf("%s: expected %q to contain %q", description, s, substr)
	}
}

func assertNotContains(t *testing.T, s, substr, description string) {
	t.Helper()
	if strings.Contains(s, substr) {
		t.Errorf("%s: expected %q to NOT contain %q", description, s, substr)
	}
}

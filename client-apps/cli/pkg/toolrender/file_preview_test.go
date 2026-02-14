package toolrender

import (
	"strings"
	"testing"
)

// =============================================================================
// formatFileContentPreview Tests
// =============================================================================

func TestFormatFileContentPreview_Empty(t *testing.T) {
	if got := formatFileContentPreview(""); got != "" {
		t.Errorf("expected empty string for empty input, got %q", got)
	}
}

func TestFormatFileContentPreview_WhitespaceOnly(t *testing.T) {
	if got := formatFileContentPreview("   \n\n  "); got != "" {
		t.Errorf("expected empty string for whitespace-only input, got %q", got)
	}
}

func TestFormatFileContentPreview_SingleLine(t *testing.T) {
	got := formatFileContentPreview("package main")

	assertContains(t, got, gutterPrefix+"package main")

	// Single-line file — no "more lines" indicator.
	assertNotContains(t, got, "⋮")
	assertNotContains(t, got, "more lines")
}

func TestFormatFileContentPreview_TwoLines(t *testing.T) {
	got := formatFileContentPreview("apiVersion: v1\nkind: Config")

	assertContains(t, got, gutterPrefix+"apiVersion: v1")
	assertContains(t, got, gutterPrefix+"kind: Config")

	// Exactly 2 lines — no "more lines" indicator.
	assertNotContains(t, got, "⋮")
}

func TestFormatFileContentPreview_ThreeLines_NoIndicator(t *testing.T) {
	got := formatFileContentPreview("line1\nline2\nline3")

	assertContains(t, got, gutterPrefix+"line1")
	assertContains(t, got, gutterPrefix+"line2")
	assertContains(t, got, gutterPrefix+"line3")

	// Exactly 3 lines — no "more lines" indicator.
	assertNotContains(t, got, "⋮")
}

func TestFormatFileContentPreview_MoreThanThreeLines(t *testing.T) {
	got := formatFileContentPreview("line1\nline2\nline3\nline4\nline5")

	assertContains(t, got, gutterPrefix+"line1")
	assertContains(t, got, gutterPrefix+"line2")
	assertContains(t, got, gutterPrefix+"line3")
	assertNotContains(t, got, gutterPrefix+"line4")

	// Should show "2 more lines" indicator.
	assertContains(t, got, "⋮")
	assertContains(t, got, "2 more lines")
}

func TestFormatFileContentPreview_PreservesBlankLinesInPreview(t *testing.T) {
	// Proto file: line 1 is content, line 2 is blank, line 3 is content.
	got := formatFileContentPreview("syntax = \"proto3\";\n\npackage ai.stigmer;\n\nimport \"google/protobuf/struct.proto\";")

	// All 3 preview lines should be shown, including the blank line.
	assertContains(t, got, "syntax = \"proto3\";")
	assertContains(t, got, "package ai.stigmer;")

	// "2 more lines" for lines 4-5.
	assertContains(t, got, "2 more lines")
}

func TestFormatFileContentPreview_TrimsTrailingBlankLinesInPreview(t *testing.T) {
	// First 3 lines: "#!/bin/bash", "", "" — trailing blanks trimmed to just the shebang.
	got := formatFileContentPreview("#!/bin/bash\n\n\nset -euo pipefail\necho hello")

	assertContains(t, got, gutterPrefix+"#!/bin/bash")

	// Trailing blank lines within the 3-line window are trimmed,
	// so only 1 line is rendered. Remaining = 5 total - 1 shown = 4.
	assertContains(t, got, "4 more lines")
}

func TestFormatFileContentPreview_AllFirstThreeLinesBlank_FallsBack(t *testing.T) {
	// First 3 lines are all blank, then real content.
	got := formatFileContentPreview("\n\n\nimport os\nimport sys")

	// Should fall back to showing the first non-empty line.
	assertContains(t, got, gutterPrefix+"import os")

	// Remaining = 5 total - 1 shown = 4.
	assertContains(t, got, "4 more lines")
}

func TestFormatFileContentPreview_LongLineTruncated(t *testing.T) {
	longLine := strings.Repeat("x", 200)
	got := formatFileContentPreview(longLine)

	assertContains(t, got, "...")
	// Ensure the gutter is present.
	assertContains(t, got, "│")
}

func TestFormatFileContentPreview_ReprStripping(t *testing.T) {
	// Defense-in-depth: raw ToolMessage repr should be stripped.
	input := "content='import os\nimport sys' name='read' tool_call_id='toolu_xyz'"
	got := formatFileContentPreview(input)

	assertContains(t, got, "import os")
	assertNotContains(t, got, "name='read'")
	assertNotContains(t, got, "content=")
}

func TestFormatFileContentPreview_ManyLines_CorrectRemaining(t *testing.T) {
	// Build a 30-line file.
	lines := make([]string, 30)
	for i := range lines {
		lines[i] = strings.Repeat("a", 10)
	}
	got := formatFileContentPreview(strings.Join(lines, "\n"))

	// Should show 3 lines + "27 more lines".
	assertContains(t, got, "27 more lines")
}

// =============================================================================
// countLines Tests
// =============================================================================

func TestCountLines_Empty(t *testing.T) {
	if got := countLines(""); got != 0 {
		t.Errorf("expected 0 for empty string, got %d", got)
	}
}

func TestCountLines_SingleLine(t *testing.T) {
	if got := countLines("hello"); got != 1 {
		t.Errorf("expected 1, got %d", got)
	}
}

func TestCountLines_MultipleLines(t *testing.T) {
	if got := countLines("a\nb\nc"); got != 3 {
		t.Errorf("expected 3, got %d", got)
	}
}

func TestCountLines_TrailingNewline(t *testing.T) {
	// "a\nb\n" splits into ["a", "b", ""], so 3 lines.
	if got := countLines("a\nb\n"); got != 3 {
		t.Errorf("expected 3, got %d", got)
	}
}

// =============================================================================
// formatLineCount Tests
// =============================================================================

func TestFormatLineCount_Zero(t *testing.T) {
	if got := formatLineCount(0); got != "0 lines" {
		t.Errorf("expected %q, got %q", "0 lines", got)
	}
}

func TestFormatLineCount_One(t *testing.T) {
	if got := formatLineCount(1); got != "1 line" {
		t.Errorf("expected %q, got %q", "1 line", got)
	}
}

func TestFormatLineCount_Many(t *testing.T) {
	if got := formatLineCount(33); got != "33 lines" {
		t.Errorf("expected %q, got %q", "33 lines", got)
	}
}

// =============================================================================
// Gutter Alignment Tests
// =============================================================================

func TestFormatFileContentPreview_GutterAlignment(t *testing.T) {
	got := formatFileContentPreview("line1\nline2\nline3\nline4")

	// Each preview line should start with the gutter prefix.
	for _, line := range strings.Split(got, "\n") {
		if strings.Contains(line, "more lines") {
			// The ellipsis line uses a different prefix.
			assertContains(t, line, ellipsisPrefix)
		} else {
			assertContains(t, line, "│")
		}
	}
}

func TestFormatFileContentPreview_EllipsisPrefixAligned(t *testing.T) {
	got := formatFileContentPreview("a\nb\nc\nd\ne")

	// The ellipsis prefix should have the same indentation width as the gutter.
	assertContains(t, got, ellipsisPrefix)
}

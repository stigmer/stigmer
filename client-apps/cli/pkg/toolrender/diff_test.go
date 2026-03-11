package toolrender

import (
	"strings"
	"testing"
)

// =============================================================================
// FormatDiff
// =============================================================================

func TestFormatDiff_BasicReplacement(t *testing.T) {
	old := "line1\nline2\nline3\n"
	new := "line1\nchanged\nline3\nextra\n"

	got := FormatDiff(old, new)
	plain := stripANSI(got)

	assertContains(t, got, "-line2")
	assertContains(t, got, "+changed")
	assertContains(t, got, "+extra")
	assertContains(t, got, " line1")
	assertContains(t, got, " line3")
	if !strings.Contains(plain, "@@") {
		t.Error("expected hunk marker @@")
	}
}

func TestFormatDiff_PureInsertion(t *testing.T) {
	old := "aaa\nbbb\n"
	new := "aaa\nbbb\nccc\n"

	got := FormatDiff(old, new)

	assertContains(t, got, "+ccc")
	assertNotContains(t, got, "-aaa")
	assertNotContains(t, got, "-bbb")
}

func TestFormatDiff_PureDeletion(t *testing.T) {
	old := "aaa\nbbb\nccc\n"
	new := "aaa\nccc\n"

	got := FormatDiff(old, new)

	assertContains(t, got, "-bbb")
	assertNotContains(t, got, "+bbb")
}

func TestFormatDiff_IdenticalTexts(t *testing.T) {
	text := "same\ncontent\n"
	got := FormatDiff(text, text)
	if got != "" {
		t.Errorf("expected empty string for identical texts, got %q", got)
	}
}

func TestFormatDiff_EmptyOldText(t *testing.T) {
	got := FormatDiff("", "new line\n")
	assertContains(t, got, "+new line")
}

func TestFormatDiff_EmptyNewText(t *testing.T) {
	got := FormatDiff("old line\n", "")
	assertContains(t, got, "-old line")
}

func TestFormatDiff_LargeTextSmallChange(t *testing.T) {
	var lines []string
	for i := 0; i < 50; i++ {
		lines = append(lines, "unchanged line")
	}
	old := strings.Join(lines, "\n") + "\n"

	modifiedLines := make([]string, len(lines))
	copy(modifiedLines, lines)
	modifiedLines[25] = "CHANGED LINE"
	new := strings.Join(modifiedLines, "\n") + "\n"

	got := FormatDiff(old, new)
	plain := stripANSI(got)

	assertContains(t, got, "-unchanged line")
	assertContains(t, got, "+CHANGED LINE")

	// Context=3 should produce a compact diff, not 50+ lines.
	outputLines := strings.Split(plain, "\n")
	if len(outputLines) > 15 {
		t.Errorf("expected compact diff with context, got %d lines", len(outputLines))
	}
}

func TestFormatDiff_SkipsFileHeaders(t *testing.T) {
	got := FormatDiff("a\n", "b\n")
	plain := stripANSI(got)

	if strings.Contains(plain, "---") {
		t.Error("diff should not contain --- file header")
	}
	if strings.Contains(plain, "+++") {
		t.Error("diff should not contain +++ file header")
	}
}

func TestFormatDiff_MultiHunk(t *testing.T) {
	var lines []string
	for i := 0; i < 30; i++ {
		lines = append(lines, "line")
	}
	old := strings.Join(lines, "\n") + "\n"

	modifiedLines := make([]string, len(lines))
	copy(modifiedLines, lines)
	modifiedLines[2] = "CHANGED_EARLY"
	modifiedLines[27] = "CHANGED_LATE"
	new := strings.Join(modifiedLines, "\n") + "\n"

	got := FormatDiff(old, new)
	plain := stripANSI(got)

	hunkCount := strings.Count(plain, "@@")
	if hunkCount < 2 {
		t.Errorf("expected at least 2 hunk markers for separated changes, got %d", hunkCount)
	}
}

// =============================================================================
// FormatDiffPreview
// =============================================================================

func TestFormatDiffPreview_BasicOutput(t *testing.T) {
	old := "aaa\nbbb\n"
	new := "aaa\nccc\n"

	got := FormatDiffPreview(old, new, 10)
	plain := stripANSI(got)

	if !strings.Contains(plain, "-bbb") {
		t.Error("preview should contain removed line")
	}
	if !strings.Contains(plain, "+ccc") {
		t.Error("preview should contain added line")
	}
	// Preview lines should be indented
	for _, line := range strings.Split(plain, "\n") {
		if line != "" && !strings.HasPrefix(line, "    ") {
			t.Errorf("expected 4-space indent, got %q", line)
		}
	}
}

func TestFormatDiffPreview_Truncation(t *testing.T) {
	old := "a\nb\nc\nd\ne\nf\ng\n"
	new := "A\nB\nC\nD\nE\nF\nG\n"

	got := FormatDiffPreview(old, new, 3)
	plain := stripANSI(got)

	if !strings.Contains(plain, "more lines") {
		t.Error("expected truncation indicator")
	}
}

func TestFormatDiffPreview_IdenticalTexts(t *testing.T) {
	got := FormatDiffPreview("same\n", "same\n", 10)
	if got != "" {
		t.Errorf("expected empty for identical, got %q", got)
	}
}

// =============================================================================
// IsEditTool / IsWriteTool / IsCreateTool
// =============================================================================

func TestIsEditTool(t *testing.T) {
	editTools := []string{"edit", "edit_file"}
	for _, name := range editTools {
		if !IsEditTool(name) {
			t.Errorf("IsEditTool(%q) = false, want true", name)
		}
	}

	nonEdit := []string{"write", "write_file", "create_file", "read", "shell", "delete_file"}
	for _, name := range nonEdit {
		if IsEditTool(name) {
			t.Errorf("IsEditTool(%q) = true, want false", name)
		}
	}
}

func TestIsWriteTool(t *testing.T) {
	writeTools := []string{"write", "write_file", "create_file", "overwrite_file"}
	for _, name := range writeTools {
		if !IsWriteTool(name) {
			t.Errorf("IsWriteTool(%q) = false, want true", name)
		}
	}

	nonWrite := []string{"edit", "edit_file", "read", "shell", "delete_file"}
	for _, name := range nonWrite {
		if IsWriteTool(name) {
			t.Errorf("IsWriteTool(%q) = true, want false", name)
		}
	}
}

func TestIsCreateTool(t *testing.T) {
	if !IsCreateTool("create_file") {
		t.Error("IsCreateTool(create_file) = false, want true")
	}
	nonCreate := []string{"write", "write_file", "overwrite_file", "edit", "read"}
	for _, name := range nonCreate {
		if IsCreateTool(name) {
			t.Errorf("IsCreateTool(%q) = true, want false", name)
		}
	}
}

package executiontui

import "testing"

// =============================================================================
// blockStartLine Tests (T04)
// =============================================================================

func TestBlockStartLine_FirstBlock(t *testing.T) {
	blocks := []contentBlock{
		{content: "line one"},
		{content: "line two"},
	}

	got := blockStartLine(blocks, -1, 0)
	if got != 0 {
		t.Errorf("blockStartLine(target=0) = %d, want 0", got)
	}
}

func TestBlockStartLine_SecondBlock(t *testing.T) {
	blocks := []contentBlock{
		{content: "line one"},
		{content: "line two"},
	}

	// Block 0 is 1 line + 1 separator = 2 lines before block 1.
	got := blockStartLine(blocks, -1, 1)
	if got != 2 {
		t.Errorf("blockStartLine(target=1) = %d, want 2", got)
	}
}

func TestBlockStartLine_MultilineBlock(t *testing.T) {
	blocks := []contentBlock{
		{content: "line one\nline two\nline three"},
		{content: "target block"},
	}

	// Block 0 is 3 lines + 1 separator = 4 lines before block 1.
	got := blockStartLine(blocks, -1, 1)
	if got != 4 {
		t.Errorf("blockStartLine(target=1) = %d, want 4", got)
	}
}

func TestBlockStartLine_SkipsEmptyBlocks(t *testing.T) {
	blocks := []contentBlock{
		{content: "block A"},
		{content: ""},           // empty — skipped in rendering
		{content: "block C"},
	}

	// Block 0 = 1 line + 1 separator = 2 lines. Empty block is skipped.
	got := blockStartLine(blocks, -1, 2)
	if got != 2 {
		t.Errorf("blockStartLine(target=2) = %d, want 2", got)
	}
}

func TestBlockStartLine_ExpandableBlock_CountsDecorations(t *testing.T) {
	blocks := []contentBlock{
		{preview: "header\n     │ line 1\n     │ line 2", full: "full", expandable: true},
		{content: "target"},
	}

	// Expandable block (collapsed, unfocused) gets decorated:
	// "  header ▶\n     │ line 1\n     │ line 2" = 3 lines + 1 separator = 4.
	got := blockStartLine(blocks, -1, 1)
	if got != 4 {
		t.Errorf("blockStartLine(target=1 after expandable) = %d, want 4", got)
	}
}

func TestBlockStartLine_ThirdBlock(t *testing.T) {
	blocks := []contentBlock{
		{content: "A"},
		{content: "B"},
		{content: "C"},
	}

	// A = 1 line + 1 sep, B = 1 line + 1 sep → block 2 starts at line 4.
	got := blockStartLine(blocks, -1, 2)
	if got != 4 {
		t.Errorf("blockStartLine(target=2) = %d, want 4", got)
	}
}

// =============================================================================
// blockLineCount Tests (T04)
// =============================================================================

func TestBlockLineCount_SingleLine(t *testing.T) {
	b := contentBlock{content: "one line"}
	got := blockLineCount(b, 0, -1)
	if got != 1 {
		t.Errorf("blockLineCount = %d, want 1", got)
	}
}

func TestBlockLineCount_MultiLine(t *testing.T) {
	b := contentBlock{content: "line 1\nline 2\nline 3"}
	got := blockLineCount(b, 0, -1)
	if got != 3 {
		t.Errorf("blockLineCount = %d, want 3", got)
	}
}

func TestBlockLineCount_EmptyBlock(t *testing.T) {
	b := contentBlock{content: ""}
	got := blockLineCount(b, 0, -1)
	if got != 0 {
		t.Errorf("blockLineCount = %d, want 0", got)
	}
}

func TestBlockLineCount_ExpandableBlock(t *testing.T) {
	b := contentBlock{
		preview:    "header\n     │ line 1",
		full:       "full",
		expandable: true,
	}
	// Collapsed, unfocused: "  header ▶\n     │ line 1" = 2 lines.
	got := blockLineCount(b, 0, -1)
	if got != 2 {
		t.Errorf("blockLineCount = %d, want 2", got)
	}
}

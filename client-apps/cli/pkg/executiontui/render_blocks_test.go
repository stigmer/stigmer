package executiontui

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

const testWidth = 80

func TestRenderAIContent_TextOnly(t *testing.T) {
	result := renderAIContent("Hello world", nil, testWidth)
	if !strings.Contains(result, "🤖 Agent: Hello world") {
		t.Errorf("result = %q, want to contain agent prefix with inline text", result)
	}
}

func TestRenderAIContent_WithToolCalls(t *testing.T) {
	tc := []toolrender.ToolCallInfo{
		{Name: "read_file", Args: map[string]interface{}{"path": "main.go"}},
	}
	result := renderAIContent("Reading file.", tc, testWidth)
	if !strings.Contains(result, "🤖 Agent:") {
		t.Error("result should contain agent prefix")
	}
	if !strings.Contains(result, "Read") {
		t.Error("result should contain tool render output")
	}
}

func TestRenderAIContent_NoTextNoTools(t *testing.T) {
	result := renderAIContent("", nil, testWidth)
	if !strings.Contains(result, "invoking tools") {
		t.Errorf("result = %q, want invoking tools indicator", result)
	}
}

func TestRenderAIContent_MarkdownHeader(t *testing.T) {
	result := renderAIContent("# Analysis Results\n\nThe code looks good.", nil, testWidth)
	plain := ansi.Strip(result)
	if !strings.Contains(plain, "Analysis Results") {
		t.Errorf("header text should be present, got %q", plain)
	}
	if strings.Contains(plain, "# ") {
		t.Error("raw markdown header prefix should not appear in rendered output")
	}
	if !strings.HasPrefix(result, "🤖 Agent:\n") {
		t.Error("markdown content should use block prefix format (prefix on its own line)")
	}
}

func TestRenderAIContent_MarkdownList(t *testing.T) {
	result := renderAIContent("- Item one\n- Item two", nil, testWidth)
	plain := ansi.Strip(result)
	if !strings.Contains(plain, "Item one") || !strings.Contains(plain, "Item two") {
		t.Errorf("list items should be preserved, got %q", plain)
	}
}

func TestRenderAIContent_MarkdownBold(t *testing.T) {
	result := renderAIContent("The code has **3 issues**.", nil, testWidth)
	plain := ansi.Strip(result)
	if !strings.Contains(plain, "3 issues") {
		t.Errorf("bold text should be preserved, got %q", plain)
	}
	if strings.Contains(plain, "**") {
		t.Error("raw markdown bold markers should not appear in rendered output")
	}
}

func TestRenderAIContent_PlainTextKeepsInlinePrefix(t *testing.T) {
	result := renderAIContent("I'll read the file for you.", nil, testWidth)
	if !strings.HasPrefix(result, "🤖 Agent: ") {
		t.Error("plain text should use inline prefix format")
	}
}

func TestRenderStreamingAI_EmptyContent(t *testing.T) {
	result := renderStreamingAI("")
	if !strings.Contains(result, "🤖 Agent: ▍") {
		t.Errorf("result = %q, want cursor indicator", result)
	}
}

func TestRenderStreamingAI_WithContent(t *testing.T) {
	result := renderStreamingAI("Hello")
	if !strings.Contains(result, "Hello▍") {
		t.Errorf("result = %q, want content + cursor", result)
	}
}

func TestRenderHumanContent(t *testing.T) {
	result := renderHumanContent("What is this file?")
	if result != "💬 You: What is this file?" {
		t.Errorf("result = %q", result)
	}
}

func TestRenderPhaseChange_InProgress(t *testing.T) {
	result := renderPhaseChange("in_progress", "pending")
	if result == "" {
		t.Error("in_progress phase should produce output")
	}
}

func TestRenderPhaseChange_ResumedAfterApproval_Suppressed(t *testing.T) {
	result := renderPhaseChange("in_progress", "waiting_for_approval")
	if result != "" {
		t.Errorf("resumed-after-approval should be suppressed, got %q", result)
	}
}

func TestRenderPhaseChange_WaitingForApproval_Suppressed(t *testing.T) {
	result := renderPhaseChange("waiting_for_approval", "in_progress")
	if result != "" {
		t.Errorf("waiting_for_approval should be suppressed, got %q", result)
	}
}

func TestRenderApprovalPrompt(t *testing.T) {
	result := renderApprovalPrompt("shell", `{"command":"ls"}`, "Execute command")
	if !strings.Contains(result, "APPROVAL REQUIRED") {
		t.Error("should contain APPROVAL REQUIRED")
	}
	if !strings.Contains(result, "shell") {
		t.Error("should contain tool name")
	}
	if !strings.Contains(result, "[a] Approve") {
		t.Error("should contain key hints")
	}
}

func TestRebuildViewportContent_Empty(t *testing.T) {
	result := rebuildViewportContent(nil, -1)
	if result != "" {
		t.Errorf("empty blocks should produce empty content, got %q", result)
	}
}

func TestRebuildViewportContent_MultipleBlocks(t *testing.T) {
	blocks := []contentBlock{
		{content: "block1"},
		{content: "block2"},
		{content: "block3"},
	}
	result := rebuildViewportContent(blocks, -1)
	if !strings.Contains(result, "block1") || !strings.Contains(result, "block2") {
		t.Error("should contain all block content")
	}
	if strings.Count(result, "\n\n") != 2 {
		t.Errorf("expected 2 block separators, got %d", strings.Count(result, "\n\n"))
	}
}

// =============================================================================
// Expand/Collapse Indicator Tests (T03)
// =============================================================================

func TestDecorateExpandableBlock_CollapsedUnfocused(t *testing.T) {
	got := decorateExpandableBlock("  📖 Read: main.go", false, false)

	if !strings.HasPrefix(got, "  ") {
		t.Errorf("unfocused block should have indent prefix, got %q", got)
	}
	if !strings.Contains(got, "▶") {
		t.Error("collapsed block should have ▶ indicator")
	}
	if strings.Contains(got, "▸") {
		t.Error("unfocused block should NOT have ▸ prefix")
	}
}

func TestDecorateExpandableBlock_CollapsedFocused(t *testing.T) {
	got := decorateExpandableBlock("  📖 Read: main.go", false, true)

	if !strings.HasPrefix(got, "▸") {
		t.Errorf("focused block should start with ▸, got %q", got)
	}
	if !strings.Contains(got, "▶") {
		t.Error("collapsed block should have ▶ indicator")
	}
}

func TestDecorateExpandableBlock_ExpandedFocused(t *testing.T) {
	got := decorateExpandableBlock("  📖 Read: main.go", true, true)

	if !strings.HasPrefix(got, "▸") {
		t.Errorf("focused block should start with ▸, got %q", got)
	}
	if !strings.Contains(got, "▼") {
		t.Error("expanded block should have ▼ indicator")
	}
}

func TestDecorateExpandableBlock_WithMultilineContent(t *testing.T) {
	input := "  📖 Read: main.go\n     │ package main\n     │ import \"fmt\""
	got := decorateExpandableBlock(input, true, true)

	lines := strings.SplitN(got, "\n", 2)
	if !strings.Contains(lines[0], "▼") {
		t.Error("first line should have ▼ indicator")
	}
	if !strings.Contains(lines[1], "│ package main") {
		t.Error("subsequent lines should be preserved")
	}
}

func TestRebuildViewportContent_ExpandableBlocks_ShowIndicators(t *testing.T) {
	blocks := []contentBlock{
		{content: "human message"},
		{preview: "  📖 Read: a.go", full: "  📖 Read: a.go\n     │ package a", expandable: true},
		{content: "system message"},
		{preview: "  📂 List: /workspace", full: "  📂 List: /workspace\n     │ a.go\n     │ b.go", expandable: true, expanded: true},
	}

	result := rebuildViewportContent(blocks, 3)

	if !strings.Contains(result, "▶") {
		t.Error("collapsed block should have ▶ indicator")
	}
	if !strings.Contains(result, "▸") {
		t.Error("focused block should have ▸ indicator")
	}
	if !strings.Contains(result, "▼") {
		t.Error("expanded block should have ▼ indicator")
	}
	if strings.Count(result, "▶") > 1 {
		t.Error("non-expandable blocks should not have ▶ indicator")
	}
}

func TestRebuildViewportContent_ExpandableBlock_UsesDisplayContent(t *testing.T) {
	blocks := []contentBlock{
		{preview: "collapsed text", full: "expanded text", expandable: true, expanded: true},
	}

	result := rebuildViewportContent(blocks, -1)

	if !strings.Contains(result, "expanded text") {
		t.Error("expanded block should show full content")
	}
	if strings.Contains(result, "collapsed text") {
		t.Error("expanded block should NOT show preview content")
	}
}

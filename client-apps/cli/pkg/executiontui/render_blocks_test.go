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
	result := renderApprovalPrompt("shell", `{"command":"ls"}`, "Execute command", false, "")
	if !strings.Contains(result, "APPROVAL REQUIRED") {
		t.Error("should contain APPROVAL REQUIRED")
	}
	if !strings.Contains(result, "shell") {
		t.Error("should contain tool name")
	}
}

func TestRenderApprovalPrompt_SubAgent(t *testing.T) {
	result := renderApprovalPrompt("Write", "path: README.md", "Write file to disk", true, "general-purpose")
	if !strings.Contains(result, "APPROVAL REQUIRED") {
		t.Error("should contain APPROVAL REQUIRED")
	}
	if !strings.Contains(result, "general-purpose") {
		t.Error("should contain sub-agent name")
	}
	if !strings.Contains(result, "sub-agent") {
		t.Error("should contain sub-agent label")
	}
	if !strings.Contains(result, "Write") {
		t.Error("should contain tool name")
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

// =============================================================================
// Todo Block Tests
// =============================================================================

func TestTodoStatusIcon(t *testing.T) {
	tests := []struct {
		status string
		want   string
	}{
		{"in_progress", "●"},
		{"pending", "○"},
		{"completed", "✓"},
		{"cancelled", "─"},
		{"unknown_status", "?"},
		{"", "?"},
	}
	for _, tt := range tests {
		got := todoStatusIcon(tt.status)
		if got != tt.want {
			t.Errorf("todoStatusIcon(%q) = %q, want %q", tt.status, got, tt.want)
		}
	}
}

func TestSortTodosForDisplay(t *testing.T) {
	todos := []TodoItem{
		{ID: "1", Content: "first pending", Status: "pending"},
		{ID: "2", Content: "completed task", Status: "completed"},
		{ID: "3", Content: "active task", Status: "in_progress"},
		{ID: "4", Content: "second pending", Status: "pending"},
		{ID: "5", Content: "cancelled task", Status: "cancelled"},
	}

	sorted := sortTodosForDisplay(todos)

	// Verify order: in_progress, pending, pending, completed, cancelled.
	expectedIDs := []string{"3", "1", "4", "2", "5"}
	for i, want := range expectedIDs {
		if sorted[i].ID != want {
			t.Errorf("sorted[%d].ID = %q, want %q", i, sorted[i].ID, want)
		}
	}

	// Verify original slice is not mutated.
	if todos[0].ID != "1" {
		t.Error("sortTodosForDisplay should not mutate the input slice")
	}
}

func TestSortTodosForDisplay_StableWithinGroup(t *testing.T) {
	todos := []TodoItem{
		{ID: "a", Content: "first", Status: "pending"},
		{ID: "b", Content: "second", Status: "pending"},
		{ID: "c", Content: "third", Status: "pending"},
	}

	sorted := sortTodosForDisplay(todos)

	for i, want := range []string{"a", "b", "c"} {
		if sorted[i].ID != want {
			t.Errorf("sorted[%d].ID = %q, want %q (stable order within group)", i, sorted[i].ID, want)
		}
	}
}

func TestRenderTodoPreview(t *testing.T) {
	todos := []TodoItem{
		{ID: "1", Content: "task A", Status: "completed"},
		{ID: "2", Content: "task B", Status: "in_progress"},
		{ID: "3", Content: "task C", Status: "pending"},
		{ID: "4", Content: "task D", Status: "completed"},
		{ID: "5", Content: "task E", Status: "pending"},
	}

	got := renderTodoPreview(todos)
	want := "📋 Tasks (2/5 done)"
	if got != want {
		t.Errorf("renderTodoPreview() = %q, want %q", got, want)
	}
}

func TestRenderTodoPreview_AllCompleted(t *testing.T) {
	todos := []TodoItem{
		{ID: "1", Content: "done", Status: "completed"},
		{ID: "2", Content: "also done", Status: "completed"},
	}

	got := renderTodoPreview(todos)
	want := "📋 Tasks (2/2 done)"
	if got != want {
		t.Errorf("renderTodoPreview() = %q, want %q", got, want)
	}
}

func TestRenderTodoPreview_NoneCompleted(t *testing.T) {
	todos := []TodoItem{
		{ID: "1", Content: "not done", Status: "pending"},
	}

	got := renderTodoPreview(todos)
	want := "📋 Tasks (0/1 done)"
	if got != want {
		t.Errorf("renderTodoPreview() = %q, want %q", got, want)
	}
}

func TestRenderTodoExpanded_EmptyList(t *testing.T) {
	got := renderTodoExpanded(nil)
	want := "📋 Tasks (0/0 done)"
	if got != want {
		t.Errorf("renderTodoExpanded(nil) = %q, want %q", got, want)
	}
}

func TestRenderTodoExpanded(t *testing.T) {
	todos := []TodoItem{
		{ID: "1", Content: "pending task", Status: "pending"},
		{ID: "2", Content: "active task", Status: "in_progress"},
		{ID: "3", Content: "done task", Status: "completed"},
	}

	got := renderTodoExpanded(todos)
	plain := ansi.Strip(got)

	// Header present.
	if !strings.Contains(plain, "Tasks (1/3 done)") {
		t.Errorf("expanded view should contain header, got %q", plain)
	}

	// All items present.
	if !strings.Contains(plain, "● active task") {
		t.Error("expanded view should contain in_progress item with ● icon")
	}
	if !strings.Contains(plain, "○ pending task") {
		t.Error("expanded view should contain pending item with ○ icon")
	}
	if !strings.Contains(plain, "✓ done task") {
		t.Error("expanded view should contain completed item with ✓ icon")
	}

	// Verify sort order: in_progress appears before pending in the output.
	activeIdx := strings.Index(plain, "● active task")
	pendingIdx := strings.Index(plain, "○ pending task")
	completedIdx := strings.Index(plain, "✓ done task")
	if activeIdx > pendingIdx {
		t.Error("in_progress item should appear before pending item")
	}
	if pendingIdx > completedIdx {
		t.Error("pending item should appear before completed item")
	}

	// Gutter borders present.
	if !strings.Contains(plain, "│") {
		t.Error("expanded view should contain gutter borders")
	}
}

func TestRenderTodoExpanded_DimmedCompleted(t *testing.T) {
	todos := []TodoItem{
		{ID: "1", Content: "active task", Status: "in_progress"},
		{ID: "2", Content: "done task", Status: "completed"},
	}

	got := renderTodoExpanded(todos)

	// The raw output (with ANSI) should contain the content text.
	// Completed items have dimmed content, so the raw string will have
	// ANSI escape sequences around "done task" but not around "active task".
	plain := ansi.Strip(got)
	if !strings.Contains(plain, "active task") {
		t.Error("active task content should be present")
	}
	if !strings.Contains(plain, "done task") {
		t.Error("done task content should be present even when dimmed")
	}

	// The active task line should NOT have dim styling on its content.
	// Find the line containing "active task" in the raw output.
	for _, line := range strings.Split(got, "\n") {
		plainLine := ansi.Strip(line)
		if strings.Contains(plainLine, "● active task") {
			// The content portion "active task" should appear without
			// ANSI wrapping (i.e., stripping ANSI from just the content
			// portion should match the raw content portion).
			contentStart := strings.Index(line, "● active task")
			if contentStart == -1 {
				// Content has ANSI codes interspersed — that means it's styled,
				// which it should NOT be for in_progress items.
				t.Error("in_progress item content should not be dimmed")
			}
		}
	}
}

func TestNewTodoBlock_StartsExpanded(t *testing.T) {
	b := newTodoBlock("preview", "full content")

	if !b.expandable {
		t.Error("todo block should be expandable")
	}
	if !b.expanded {
		t.Error("todo block should start expanded")
	}
	if b.blockType != blockTodo {
		t.Errorf("blockType = %d, want blockTodo", b.blockType)
	}
	if b.preview != "preview" {
		t.Errorf("preview = %q, want %q", b.preview, "preview")
	}
	if b.full != "full content" {
		t.Errorf("full = %q, want %q", b.full, "full content")
	}
}

func TestNewTodoBlock_DisplayContent(t *testing.T) {
	b := newTodoBlock("summary", "summary\n     │ ● task")

	// Expanded by default — displayContent should return full.
	if got := b.displayContent(); got != "summary\n     │ ● task" {
		t.Errorf("expanded displayContent() = %q, want full content", got)
	}

	// After collapsing, displayContent should return preview.
	b.expanded = false
	if got := b.displayContent(); got != "summary" {
		t.Errorf("collapsed displayContent() = %q, want preview", got)
	}
}

// =============================================================================
// Sub-Agent Context Separator Tests
// =============================================================================

func TestRenderSubAgentSeparator(t *testing.T) {
	got := renderSubAgentSeparator("researcher")
	plain := ansi.Strip(got)
	if !strings.Contains(plain, "researcher") {
		t.Errorf("separator should contain sub-agent name, got %q", plain)
	}
	if !strings.Contains(plain, "🔀") {
		t.Errorf("separator should use 🔀 prefix, got %q", plain)
	}
}

func TestRenderSubAgentSeparator_EmptyName(t *testing.T) {
	got := renderSubAgentSeparator("")
	plain := ansi.Strip(got)
	if !strings.Contains(plain, "sub-agent") {
		t.Errorf("separator with empty name should fall back to 'sub-agent', got %q", plain)
	}
}

func TestNeedsSubAgentSeparator_MainAgentOnly(t *testing.T) {
	blocks := []contentBlock{
		{content: "block1"},
		{content: "block2"},
	}
	for i := range blocks {
		if needsSubAgentSeparator(blocks, i) {
			t.Errorf("main-agent block at index %d should not need a separator", i)
		}
	}
}

func TestNeedsSubAgentSeparator_EnteringSubAgent(t *testing.T) {
	blocks := []contentBlock{
		{content: "main block"},
		{content: "sub block", subAgentID: "sa-1", subAgentName: "researcher"},
	}
	if needsSubAgentSeparator(blocks, 0) {
		t.Error("main-agent block should not need separator")
	}
	if !needsSubAgentSeparator(blocks, 1) {
		t.Error("first sub-agent block after main should need separator")
	}
}

func TestNeedsSubAgentSeparator_SameSubAgent(t *testing.T) {
	blocks := []contentBlock{
		{content: "sub block 1", subAgentID: "sa-1"},
		{content: "sub block 2", subAgentID: "sa-1"},
	}
	if !needsSubAgentSeparator(blocks, 0) {
		t.Error("first sub-agent block in the list should need separator")
	}
	if needsSubAgentSeparator(blocks, 1) {
		t.Error("consecutive block from same sub-agent should not need separator")
	}
}

func TestNeedsSubAgentSeparator_DifferentSubAgents(t *testing.T) {
	blocks := []contentBlock{
		{content: "from sa-1", subAgentID: "sa-1"},
		{content: "from sa-2", subAgentID: "sa-2"},
	}
	if !needsSubAgentSeparator(blocks, 1) {
		t.Error("block from different sub-agent should need separator")
	}
}

func TestRebuildViewportContent_SubAgentSeparator(t *testing.T) {
	blocks := []contentBlock{
		{content: "main block"},
		{content: "sub block", subAgentID: "sa-1", subAgentName: "researcher"},
	}
	result := rebuildViewportContent(blocks, -1)
	plain := ansi.Strip(result)
	if !strings.Contains(plain, "researcher") {
		t.Errorf("viewport should contain sub-agent separator with name, got %q", plain)
	}
	if !strings.Contains(plain, "main block") || !strings.Contains(plain, "sub block") {
		t.Error("viewport should contain both block contents")
	}
}

func TestRebuildViewportContent_NoSeparator_MainAgent(t *testing.T) {
	blocks := []contentBlock{
		{content: "block1"},
		{content: "block2"},
		{content: "block3"},
	}
	result := rebuildViewportContent(blocks, -1)
	plain := ansi.Strip(result)
	if strings.Contains(plain, "🔀") {
		t.Error("main-agent-only blocks should not have any separators")
	}
}

func TestRebuildViewportContent_NoSeparator_SameSubAgent(t *testing.T) {
	blocks := []contentBlock{
		{content: "sub block 1", subAgentID: "sa-1", subAgentName: "researcher"},
		{content: "sub block 2", subAgentID: "sa-1", subAgentName: "researcher"},
	}
	result := rebuildViewportContent(blocks, -1)
	plain := ansi.Strip(result)
	// Should have exactly one fallback separator (before the first orphaned
	// sub-agent block), not two.
	if strings.Count(plain, "researcher") != 1 {
		t.Errorf("expected exactly 1 separator for consecutive same-sub-agent blocks, got %d occurrences of 'researcher'",
			strings.Count(plain, "researcher"))
	}
}

// =============================================================================
// Sub-Agent Header Block Interleaving Tests
//
// These tests verify that needsSubAgentSeparator is robust against block
// interleaving — when top-level events are appended between sub-agent blocks
// across Recv() iterations, the header block prevents spurious separators.
// =============================================================================

func TestNeedsSubAgentSeparator_HeaderPreventsAll(t *testing.T) {
	header := newSubAgentBlock("gp", "task desc", 0, "")
	header.subAgentID = "sa-1"
	blocks := []contentBlock{
		{content: "main block"},
		header,
		{content: "sub tool 1", subAgentID: "sa-1"},
		{content: "sub tool 2", subAgentID: "sa-1"},
	}
	if needsSubAgentSeparator(blocks, 2) {
		t.Error("sub-agent block after its header should not need separator")
	}
	if needsSubAgentSeparator(blocks, 3) {
		t.Error("consecutive sub-agent block after header should not need separator")
	}
}

func TestNeedsSubAgentSeparator_HeaderBlockedByInterleaving(t *testing.T) {
	// Simulates: header created, then a top-level event is appended between
	// Recv() iterations, followed by more sub-agent blocks. The old logic
	// would show a separator here because the immediately preceding block
	// has a different subAgentID. The new logic finds the header and skips.
	header := newSubAgentBlock("gen", "explore", 0, "")
	header.subAgentID = "sa-1"
	blocks := []contentBlock{
		{content: "main block"},
		header,
		{content: "sub tool 1", subAgentID: "sa-1"},
		{content: "system message"},                                       // top-level interleaving
		{content: "sub tool 2", subAgentID: "sa-1", subAgentName: "gen"}, // should NOT get separator
	}
	if needsSubAgentSeparator(blocks, 4) {
		t.Error("sub-agent block should not need separator when header exists, even with interleaved top-level block")
	}
}

func TestNeedsSubAgentSeparator_OrphanedBlocksGetSeparator(t *testing.T) {
	// No header block — sub-agent blocks are orphaned. The first one after
	// a main-agent block should get a separator; the second should not.
	blocks := []contentBlock{
		{content: "main block"},
		{content: "sub block 1", subAgentID: "sa-1"},
		{content: "sub block 2", subAgentID: "sa-1"},
	}
	if !needsSubAgentSeparator(blocks, 1) {
		t.Error("first orphaned sub-agent block after main should need separator")
	}
	if needsSubAgentSeparator(blocks, 2) {
		t.Error("consecutive orphaned block from same sub-agent should not need separator")
	}
}

func TestNeedsSubAgentSeparator_MultipleSubAgentsWithHeaders(t *testing.T) {
	h1 := newSubAgentBlock("sa1", "", 0, "")
	h1.subAgentID = "sa-1"
	h2 := newSubAgentBlock("sa2", "", 0, "")
	h2.subAgentID = "sa-2"
	blocks := []contentBlock{
		h1,
		{content: "sub-1 tool", subAgentID: "sa-1"},
		{content: "main response"},
		h2,
		{content: "sub-2 tool", subAgentID: "sa-2"},
		{content: "another main response"},
		{content: "sub-1 resumes", subAgentID: "sa-1"}, // sa-1 header at idx 0
		{content: "sub-2 resumes", subAgentID: "sa-2"}, // sa-2 header at idx 3
	}
	if needsSubAgentSeparator(blocks, 6) {
		t.Error("sa-1 block should not need separator — header at idx 0")
	}
	if needsSubAgentSeparator(blocks, 7) {
		t.Error("sa-2 block should not need separator — header at idx 3")
	}
}

func TestRebuildViewportContent_HeaderBlockNoSeparator(t *testing.T) {
	header := newSubAgentBlock("general-purpose", "Explore", 0, "")
	header.subAgentID = "sa-1"
	blocks := []contentBlock{
		{content: "main block"},
		header,
		{content: "sub tool", subAgentID: "sa-1", subAgentName: "general-purpose"},
	}
	result := rebuildViewportContent(blocks, -1)
	plain := ansi.Strip(result)
	// The header should appear once (from the blockSubAgent). No fallback
	// separator should appear.
	if strings.Count(plain, "general-purpose") != 1 {
		t.Errorf("expected exactly 1 occurrence of sub-agent name (from header only), got %d in: %q",
			strings.Count(plain, "general-purpose"), plain)
	}
}

func TestRebuildViewportContent_InterleavedWithHeader(t *testing.T) {
	header := newSubAgentBlock("gp", "explore", 0, "")
	header.subAgentID = "sa-1"
	blocks := []contentBlock{
		header,
		{content: "sub tool 1", subAgentID: "sa-1", subAgentName: "gp"},
		{content: "system event"},
		{content: "sub tool 2", subAgentID: "sa-1", subAgentName: "gp"},
	}
	result := rebuildViewportContent(blocks, -1)
	plain := ansi.Strip(result)
	// Count occurrences of "gp" — should be 1 from the header only.
	// No fallback separators because the header exists.
	gpCount := strings.Count(plain, "gp")
	if gpCount != 1 {
		t.Errorf("expected 1 occurrence of 'gp' (from header only, no fallback separators), got %d in: %q",
			gpCount, plain)
	}
}

func TestNewSubAgentBlock_AlwaysExpandable(t *testing.T) {
	b := newSubAgentBlock("general-purpose", "explore cli", 0, "")
	if !b.expandable {
		t.Error("sub-agent block should always be expandable (controls child visibility)")
	}
	dc := b.displayContent()
	if dc == "" {
		t.Fatal("sub-agent block must have visible content")
	}
	plain := ansi.Strip(dc)
	if !strings.Contains(plain, "general-purpose") {
		t.Errorf("header should contain sub-agent name, got %q", plain)
	}
}

func TestNewSubAgentBlock_WithToolCountAndStatus(t *testing.T) {
	b := newSubAgentBlock("explore", "find files", 5, "completed")
	if !b.expandable {
		t.Error("sub-agent block should be expandable")
	}
	dc := b.displayContent()
	plain := ansi.Strip(dc)
	if !strings.Contains(plain, "5 tools") {
		t.Errorf("header should contain tool count, got %q", plain)
	}
	if !strings.Contains(plain, "done") {
		t.Errorf("header should contain status badge, got %q", plain)
	}
}

func TestNewSubAgentBlock_StartsCollapsed(t *testing.T) {
	b := newSubAgentBlock("explore", "find files", 0, "running")
	if b.expanded {
		t.Error("sub-agent block should start collapsed")
	}
}

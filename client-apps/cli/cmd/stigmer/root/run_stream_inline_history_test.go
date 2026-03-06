package root

import (
	"bytes"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/toolrender"
)

func TestRenderCommittedItem_Header_WithSubject(t *testing.T) {
	item := committedItem{
		kind: kindHeader,
		header: &sessionHeaderInfo{
			AgentName: "test-agent",
			SessionID: "ses-abc123",
			Subject:   "Fix the login bug",
			Model:     "sonnet-4.6",
		},
	}
	result := renderCommittedItem(item, toolrender.CompactOptions{}, false)

	assert.Contains(t, result, "Stigmer")
	assert.Contains(t, result, "test-agent")
	assert.Contains(t, result, "ses-abc123")
	assert.Contains(t, result, "Fix the login bug")
	assert.Contains(t, result, "sonnet-4.6")
}

func TestRenderCommittedItem_Header_WithoutSubject(t *testing.T) {
	item := committedItem{
		kind: kindHeader,
		header: &sessionHeaderInfo{
			SessionID: "ses-abc123",
		},
	}
	result := renderCommittedItem(item, toolrender.CompactOptions{}, false)

	assert.Contains(t, result, "ses-abc123")
	assert.NotContains(t, result, "Subject")
}

func TestRenderCommittedItem_Header_NilHeader(t *testing.T) {
	item := committedItem{kind: kindHeader}
	result := renderCommittedItem(item, toolrender.CompactOptions{}, false)
	assert.Equal(t, "", result)
}

func TestRenderCommittedItem_ToolCompact(t *testing.T) {
	item := committedItem{
		kind: kindToolCompact,
		toolCalls: []toolrender.ToolCallInfo{{
			Name: "read_file",
			Args: map[string]interface{}{"path": "main.go"},
		}},
	}
	result := renderCommittedItem(item, toolrender.CompactOptions{}, false)

	assert.Contains(t, result, "Read")
	assert.Contains(t, result, "main.go")
}

func TestRenderCommittedItem_ToolCompact_SubAgent(t *testing.T) {
	item := committedItem{
		kind:       kindToolCompact,
		subAgentID: "sub-1",
		toolCalls: []toolrender.ToolCallInfo{{
			Name: "read_file",
			Args: map[string]interface{}{"path": "main.go"},
		}},
	}
	result := renderCommittedItem(item, toolrender.CompactOptions{}, false)

	assert.Contains(t, result, "main.go")
	assert.Contains(t, result, "│")
}

func TestRenderCommittedItem_ToolCompact_Empty(t *testing.T) {
	item := committedItem{kind: kindToolCompact}
	assert.Equal(t, "", renderCommittedItem(item, toolrender.CompactOptions{}, false))
}

func TestRenderCommittedItem_ReadGroup_Grouped(t *testing.T) {
	reads := make([]toolrender.ToolCallInfo, readGroupThreshold)
	for i := range reads {
		reads[i] = toolrender.ToolCallInfo{
			Name:   "read_file",
			Args:   map[string]interface{}{"path": "file.go"},
			Result: "content",
		}
	}
	item := committedItem{kind: kindReadGroup, toolCalls: reads}
	result := renderCommittedItem(item, toolrender.CompactOptions{}, false)

	assert.Contains(t, result, "Read")
}

func TestRenderCommittedItem_ReadGroup_Individual(t *testing.T) {
	reads := []toolrender.ToolCallInfo{
		{Name: "read_file", Args: map[string]interface{}{"path": "a.go"}},
		{Name: "read_file", Args: map[string]interface{}{"path": "b.go"}},
	}
	item := committedItem{kind: kindReadGroup, toolCalls: reads}
	result := renderCommittedItem(item, toolrender.CompactOptions{}, false)

	assert.Contains(t, result, "a.go")
	assert.Contains(t, result, "b.go")
}

func TestRenderCommittedItem_Approval(t *testing.T) {
	item := committedItem{
		kind:   kindApproval,
		action: "approve",
		toolCalls: []toolrender.ToolCallInfo{{
			Name: "write_file",
			Args: map[string]interface{}{"path": "config.go"},
		}},
	}
	result := renderCommittedItem(item, toolrender.CompactOptions{}, false)

	assert.Contains(t, result, "config.go")
}

func TestRenderCommittedItem_TextKinds(t *testing.T) {
	tests := []struct {
		name string
		kind committedKind
	}{
		{"AIMessage", kindAIMessage},
		{"HumanMessage", kindHumanMessage},
		{"SystemMessage", kindSystemMessage},
		{"SubAgentStart", kindSubAgentStart},
		{"SubAgentComplete", kindSubAgentComplete},
		{"TodoUpdate", kindTodoUpdate},
		{"PhaseChange", kindPhaseChange},
		{"Text", kindText},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			item := committedItem{kind: tt.kind, text: "expected output"}
			result := renderCommittedItem(item, toolrender.CompactOptions{}, false)
			assert.Equal(t, "expected output", result)
		})
	}
}

func TestBuildReCommitCmd_ProducesCmd(t *testing.T) {
	items := []committedItem{
		{kind: kindHeader, header: &sessionHeaderInfo{SessionID: "ses-1"}},
		{kind: kindText, text: "some output"},
		{kind: kindToolCompact, toolCalls: []toolrender.ToolCallInfo{
			{Name: "read_file", Args: map[string]interface{}{"path": "f.go"}},
		}},
	}
	rendered := renderHistoryBatch(items, toolrender.CompactOptions{}, false)
	cmd := buildReCommitCmd(rendered)
	assert.NotNil(t, cmd)
}

func TestBuildReCommitCmd_EmptyHistory(t *testing.T) {
	cmd := buildReCommitCmd("")
	assert.NotNil(t, cmd)
}

func TestRenderCommittedItem_Header_SubjectMutation(t *testing.T) {
	info := sessionHeaderInfo{
		SessionID: "ses-abc123",
	}
	item := committedItem{kind: kindHeader, header: &info}

	before := renderCommittedItem(item, toolrender.CompactOptions{}, false)
	assert.NotContains(t, before, "Subject")

	info.Subject = "Refactor auth module"
	after := renderCommittedItem(item, toolrender.CompactOptions{}, false)
	assert.Contains(t, after, "Subject")
	assert.Contains(t, after, "Refactor auth module")
}

func TestRenderToolCompactItem_MultiLine_HasTrailingBlank(t *testing.T) {
	item := committedItem{
		kind: kindToolCompact,
		toolCalls: []toolrender.ToolCallInfo{{
			Name:   "shell",
			Args:   map[string]interface{}{"command": "ls -la"},
			Result: "total 8\ndrwxr 2 user\n-rw-r 1 file",
		}},
	}
	result := renderCommittedItem(item, toolrender.CompactOptions{}, false)
	assert.True(t, strings.HasSuffix(result, "\n"),
		"multi-line tool compact should end with blank line separator")
}

// =============================================================================
// Expanded mode — renderCommittedItem
// =============================================================================

func TestRenderCommittedItem_Expanded_ShellShowsAllOutput(t *testing.T) {
	item := committedItem{
		kind: kindToolCompact,
		toolCalls: []toolrender.ToolCallInfo{{
			Name:   "shell",
			Args:   map[string]interface{}{"command": "go test ./..."},
			Status: "completed",
			Result: "ok pkg/a 0.1s\nok pkg/b 0.2s\nok pkg/c 0.3s\nok pkg/d 0.4s\nok pkg/e 0.5s\nok pkg/f 0.6s",
		}},
	}

	compact := renderCommittedItem(item, toolrender.CompactOptions{}, false)
	assert.Contains(t, compact, "more lines")

	expanded := renderCommittedItem(item, toolrender.CompactOptions{}, true)
	assert.NotContains(t, expanded, "more lines")
	assert.Contains(t, expanded, "pkg/a")
	assert.Contains(t, expanded, "pkg/f")
}

func TestRenderCommittedItem_Expanded_ReadGroupShowsAll(t *testing.T) {
	reads := make([]toolrender.ToolCallInfo, 6)
	for i := range reads {
		reads[i] = toolrender.ToolCallInfo{
			Name:   "read_file",
			Args:   map[string]interface{}{"path": fmt.Sprintf("file_%d.go", i+1)},
			Status: "completed",
			Result: "content\n",
		}
	}
	item := committedItem{kind: kindReadGroup, toolCalls: reads}

	compact := renderCommittedItem(item, toolrender.CompactOptions{}, false)
	assert.Contains(t, compact, "more")

	expanded := renderCommittedItem(item, toolrender.CompactOptions{}, true)
	assert.NotContains(t, expanded, "more")
	for i := range reads {
		assert.Contains(t, expanded, fmt.Sprintf("file_%d.go", i+1))
	}
}

func TestRenderCommittedItem_Expanded_ReadGroupSubAgent(t *testing.T) {
	reads := make([]toolrender.ToolCallInfo, 5)
	for i := range reads {
		reads[i] = toolrender.ToolCallInfo{
			Name:   "read_file",
			Args:   map[string]interface{}{"path": fmt.Sprintf("f%d.go", i+1)},
			Status: "completed",
			Result: "x\n",
		}
	}
	item := committedItem{kind: kindReadGroup, toolCalls: reads, subAgentID: "sub-1"}

	result := renderCommittedItem(item, toolrender.CompactOptions{}, true)
	assert.Contains(t, result, "│")
}

func TestRenderCommittedItem_Expanded_TextKindsUnchanged(t *testing.T) {
	item := committedItem{kind: kindAIMessage, text: "AI response text"}
	compact := renderCommittedItem(item, toolrender.CompactOptions{}, false)
	expanded := renderCommittedItem(item, toolrender.CompactOptions{}, true)
	assert.Equal(t, compact, expanded)
}

func TestRenderCommittedItem_Expanded_HeaderShowsModeIndicator(t *testing.T) {
	item := committedItem{
		kind: kindHeader,
		header: &sessionHeaderInfo{
			SessionID: "ses-abc123",
			Subject:   "Test subject",
		},
	}
	compact := renderCommittedItem(item, toolrender.CompactOptions{}, false)
	expanded := renderCommittedItem(item, toolrender.CompactOptions{}, true)

	assert.Contains(t, compact, "Stigmer")
	assert.NotContains(t, compact, "expanded")

	assert.Contains(t, expanded, "Stigmer · expanded")
	assert.Contains(t, expanded, "ses-abc123")
	assert.Contains(t, expanded, "Test subject")
}

func TestRenderCommittedItem_Expanded_ApprovalUnchanged(t *testing.T) {
	item := committedItem{
		kind:   kindApproval,
		action: "approve",
		toolCalls: []toolrender.ToolCallInfo{{
			Name: "write_file",
			Args: map[string]interface{}{"path": "config.go", "contents": "pkg config\n"},
		}},
	}
	compact := renderCommittedItem(item, toolrender.CompactOptions{}, false)
	expanded := renderCommittedItem(item, toolrender.CompactOptions{}, true)
	assert.Equal(t, compact, expanded)
}

func TestBuildReCommitCmd_Expanded_ProducesCmd(t *testing.T) {
	items := []committedItem{
		{kind: kindHeader, header: &sessionHeaderInfo{SessionID: "ses-1"}},
		{kind: kindToolCompact, toolCalls: []toolrender.ToolCallInfo{
			{Name: "shell", Args: map[string]interface{}{"command": "ls"}, Status: "completed", Result: "a\nb\nc\nd\ne"},
		}},
	}
	rendered := renderHistoryBatch(items, toolrender.CompactOptions{}, true)
	cmd := buildReCommitCmd(rendered)
	assert.NotNil(t, cmd)
}

// =============================================================================
// renderToolLine — shared compact/expanded rendering helper
// =============================================================================

func TestRenderToolLine_Compact(t *testing.T) {
	r := &inlineRenderer{expandMode: false}
	tc := toolrender.ToolCallInfo{
		Name: "read_file",
		Args: map[string]interface{}{"path": "main.go"},
	}
	line := r.renderToolLine(tc, "")
	assert.Contains(t, line, "Read")
	assert.Contains(t, line, "main.go")
}

func TestRenderToolLine_Expanded(t *testing.T) {
	r := &inlineRenderer{expandMode: true}
	tc := toolrender.ToolCallInfo{
		Name:   "shell",
		Args:   map[string]interface{}{"command": "go test ./..."},
		Status: "completed",
		Result: "ok pkg/a 0.1s\nok pkg/b 0.2s\nok pkg/c 0.3s\nok pkg/d 0.4s\nok pkg/e 0.5s\nok pkg/f 0.6s",
	}
	line := r.renderToolLine(tc, "")
	assert.Contains(t, line, "pkg/f")
	assert.NotContains(t, line, "more lines")
}

func TestRenderToolLine_SubAgent_GutterWrapped(t *testing.T) {
	r := &inlineRenderer{expandMode: false}
	tc := toolrender.ToolCallInfo{
		Name: "read_file",
		Args: map[string]interface{}{"path": "sub.go"},
	}
	line := r.renderToolLine(tc, "sub-1")
	assert.Contains(t, line, "│")
}

func TestTriggerReCommit_UsesExpandMode(t *testing.T) {
	r := &inlineRenderer{
		expandMode: true,
		history: []committedItem{
			{kind: kindHeader, header: &sessionHeaderInfo{SessionID: "ses-1"}},
			{kind: kindToolCompact, toolCalls: []toolrender.ToolCallInfo{
				{Name: "shell", Args: map[string]interface{}{"command": "ls"}, Status: "completed", Result: "out"},
			}},
		},
	}
	r.triggerReCommit()
	assert.True(t, r.expandMode)
}

// =============================================================================
// renderHistoryBatch — batched rendering correctness
// =============================================================================

func TestRenderHistoryBatch_MatchesPerItemOutput(t *testing.T) {
	items := []committedItem{
		{kind: kindHeader, header: &sessionHeaderInfo{
			AgentName: "test-agent", SessionID: "ses-xyz", Subject: "Fix auth", Model: "sonnet-4.6",
		}},
		{kind: kindAIMessage, text: "I'll analyze the code and fix the authentication issue."},
		{kind: kindToolCompact, toolCalls: []toolrender.ToolCallInfo{{
			Name: "read_file", Args: map[string]interface{}{"path": "auth.go"},
		}}},
		{kind: kindToolCompact, toolCalls: []toolrender.ToolCallInfo{{
			Name: "shell", Args: map[string]interface{}{"command": "go test ./..."}, Status: "completed",
			Result: "ok pkg/auth 0.1s\nok pkg/user 0.2s\nok pkg/api 0.3s",
		}}},
		{kind: kindReadGroup, toolCalls: func() []toolrender.ToolCallInfo {
			reads := make([]toolrender.ToolCallInfo, 4)
			for i := range reads {
				reads[i] = toolrender.ToolCallInfo{
					Name: "read_file", Status: "completed",
					Args:   map[string]interface{}{"path": fmt.Sprintf("pkg/auth/handler_%d.go", i)},
					Result: "package auth\n",
				}
			}
			return reads
		}()},
		{kind: kindApproval, action: "approve", toolCalls: []toolrender.ToolCallInfo{{
			Name: "write_file", Args: map[string]interface{}{"path": "auth.go", "contents": "package auth\n"},
		}}},
		{kind: kindHumanMessage, text: "Looks good, continue."},
		{kind: kindSystemMessage, text: "Session checkpoint saved."},
		{kind: kindSubAgentStart, text: "● Task: Update tests"},
		{kind: kindSubAgentComplete, text: "  ✓ Done (3 tools)"},
		{kind: kindPhaseChange, text: "Execution completed"},
		{kind: kindText, text: "Error: connection reset"},
	}

	opts := toolrender.CompactOptions{}

	for _, expanded := range []bool{false, true} {
		label := "compact"
		if expanded {
			label = "expanded"
		}
		t.Run(label, func(t *testing.T) {
			var b strings.Builder
			first := true
			for _, item := range items {
				text := renderCommittedItem(item, opts, expanded)
				if text == "" {
					continue
				}
				if !first {
					b.WriteByte('\n')
				}
				b.WriteString(text)
				if item.kind == kindHeader {
					b.WriteByte('\n')
				}
				if needsTrailingGap(item.kind) {
					b.WriteByte('\n')
				}
				first = false
			}
			expected := b.String()
			actual := renderHistoryBatch(items, opts, expanded)
			assert.Equal(t, expected, actual)
		})
	}
}

func TestRenderHistoryBatch_EmptyHistory(t *testing.T) {
	assert.Equal(t, "", renderHistoryBatch(nil, toolrender.CompactOptions{}, false))
	assert.Equal(t, "", renderHistoryBatch([]committedItem{}, toolrender.CompactOptions{}, false))
}

func TestRenderHistoryBatch_SingleItem(t *testing.T) {
	item := committedItem{kind: kindText, text: "only item"}
	result := renderHistoryBatch([]committedItem{item}, toolrender.CompactOptions{}, false)
	assert.Equal(t, "only item", result)
}

func TestRenderHistoryBatch_SkipsEmptyItems(t *testing.T) {
	items := []committedItem{
		{kind: kindText, text: "first"},
		{kind: kindToolCompact},
		{kind: kindText, text: "second"},
	}
	result := renderHistoryBatch(items, toolrender.CompactOptions{}, false)
	assert.Equal(t, "first\nsecond", result)
}

func TestRenderHistoryBatch_NilHeader(t *testing.T) {
	items := []committedItem{
		{kind: kindHeader},
		{kind: kindText, text: "after empty header"},
	}
	result := renderHistoryBatch(items, toolrender.CompactOptions{}, false)
	assert.Equal(t, "after empty header", result)
}

func TestRenderHistoryBatch_HeaderHasBlankLineGap(t *testing.T) {
	items := []committedItem{
		{kind: kindHeader, header: &sessionHeaderInfo{SessionID: "ses-1"}},
		{kind: kindText, text: "first content"},
	}
	result := renderHistoryBatch(items, toolrender.CompactOptions{}, false)

	headerText := renderCommittedItem(items[0], toolrender.CompactOptions{}, false)
	assert.Equal(t, headerText+"\n\nfirst content", result,
		"header should be followed by a blank line before the next item")
}

func TestRenderHistoryBatch_HeaderOnly_NoExtraNewline(t *testing.T) {
	items := []committedItem{
		{kind: kindHeader, header: &sessionHeaderInfo{SessionID: "ses-1"}},
	}
	result := renderHistoryBatch(items, toolrender.CompactOptions{}, false)

	headerText := renderCommittedItem(items[0], toolrender.CompactOptions{}, false)
	assert.Equal(t, headerText+"\n", result,
		"header-only batch should have trailing newline from the gap")
}

// =============================================================================
// commitToScrollback / renderHistoryBatch parity
// =============================================================================

func TestCommitToScrollback_MatchesRecommit(t *testing.T) {
	items := []committedItem{
		{kind: kindHeader, header: &sessionHeaderInfo{
			AgentName: "test-agent", SessionID: "ses-xyz", Subject: "Fix auth", Model: "sonnet-4.6",
		}},
		{kind: kindAIMessage, text: "I'll analyze the code and fix the authentication issue."},
		{kind: kindToolCompact, toolCalls: []toolrender.ToolCallInfo{{
			Name: "read_file", Args: map[string]interface{}{"path": "auth.go"},
		}}},
		{kind: kindToolCompact, toolCalls: []toolrender.ToolCallInfo{{
			Name: "shell", Args: map[string]interface{}{"command": "go test ./..."}, Status: "completed",
			Result: "ok pkg/auth 0.1s\nok pkg/user 0.2s\nok pkg/api 0.3s",
		}}},
		{kind: kindReadGroup, toolCalls: func() []toolrender.ToolCallInfo {
			reads := make([]toolrender.ToolCallInfo, 4)
			for i := range reads {
				reads[i] = toolrender.ToolCallInfo{
					Name: "read_file", Status: "completed",
					Args:   map[string]interface{}{"path": fmt.Sprintf("pkg/auth/handler_%d.go", i)},
					Result: "package auth\n",
				}
			}
			return reads
		}()},
		{kind: kindApproval, action: "approve", toolCalls: []toolrender.ToolCallInfo{{
			Name: "write_file", Args: map[string]interface{}{"path": "auth.go", "contents": "package auth\n"},
		}}},
		{kind: kindHumanMessage, text: "Looks good, continue."},
		{kind: kindSystemMessage, text: "Session checkpoint saved."},
		{kind: kindSubAgentStart, text: "● Task: Update tests"},
		{kind: kindSubAgentComplete, text: "  ✓ Done (3 tools)"},
		{kind: kindTodoUpdate, text: "Plan:\n  [-] Step one\n  [ ] Step two"},
		{kind: kindPhaseChange, text: "Execution completed"},
		{kind: kindText, text: "Error: connection reset"},
	}

	opts := toolrender.CompactOptions{}

	for _, expanded := range []bool{false, true} {
		label := "compact"
		if expanded {
			label = "expanded"
		}
		t.Run(label, func(t *testing.T) {
			var buf bytes.Buffer
			r := &inlineRenderer{
				cfg:        inlineRenderConfig{status: &buf},
				expandMode: expanded,
			}
			for _, item := range items {
				r.commitToScrollback(item)
			}
			liveOutput := buf.String()

			batch := renderHistoryBatch(items, opts, expanded)

			assert.Equal(t, batch+"\n", liveOutput,
				"live commitToScrollback output should match renderHistoryBatch "+
					"(plus a trailing newline from the final statusf)")
		})
	}
}

func TestNeedsTrailingGap(t *testing.T) {
	gapKinds := []committedKind{
		kindHumanMessage, kindSystemMessage, kindSubAgentComplete, kindPhaseChange,
	}
	for _, k := range gapKinds {
		assert.True(t, needsTrailingGap(k), "expected needsTrailingGap==true for kind %d", k)
	}

	noGapKinds := []committedKind{
		kindHeader, kindToolCompact, kindReadGroup, kindApproval,
		kindAIMessage, kindSubAgentStart, kindTodoUpdate, kindText,
	}
	for _, k := range noGapKinds {
		assert.False(t, needsTrailingGap(k), "expected needsTrailingGap==false for kind %d", k)
	}
}

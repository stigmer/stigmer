package root

import (
	"bytes"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/executiontui"
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
	result := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)

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
	result := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)

	assert.Contains(t, result, "ses-abc123")
	assert.NotContains(t, result, "Subject")
}

func TestRenderCommittedItem_Header_NilHeader(t *testing.T) {
	item := committedItem{kind: kindHeader}
	result := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)
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
	result := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)

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
	result := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)

	assert.Contains(t, result, "main.go")
	assert.Contains(t, result, "│")
}

func TestRenderCommittedItem_ToolCompact_Empty(t *testing.T) {
	item := committedItem{kind: kindToolCompact}
	assert.Equal(t, "", renderCommittedItem(item, toolrender.CompactOptions{}, false, false))
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
	result := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)

	assert.Contains(t, result, "Read")
}

func TestRenderCommittedItem_ReadGroup_Individual(t *testing.T) {
	reads := []toolrender.ToolCallInfo{
		{Name: "read_file", Args: map[string]interface{}{"path": "a.go"}},
		{Name: "read_file", Args: map[string]interface{}{"path": "b.go"}},
	}
	item := committedItem{kind: kindReadGroup, toolCalls: reads}
	result := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)

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
	result := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)

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
		{"PhaseChange", kindPhaseChange},
		{"Text", kindText},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			item := committedItem{kind: tt.kind, text: "expected output"}
			result := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)
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
	rendered := renderHistoryBatch(items, toolrender.CompactOptions{}, false, false)
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

	before := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)
	assert.NotContains(t, before, "Subject")

	info.Subject = "Refactor auth module"
	after := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)
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
	result := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)
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

	compact := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)
	assert.Contains(t, compact, "more lines")

	expanded := renderCommittedItem(item, toolrender.CompactOptions{}, true, false)
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

	compact := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)
	assert.Contains(t, compact, "more")

	expanded := renderCommittedItem(item, toolrender.CompactOptions{}, true, false)
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

	result := renderCommittedItem(item, toolrender.CompactOptions{}, true, false)
	assert.Contains(t, result, "│")
}

func TestRenderCommittedItem_Expanded_TextKindsUnchanged(t *testing.T) {
	item := committedItem{kind: kindAIMessage, text: "AI response text"}
	compact := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)
	expanded := renderCommittedItem(item, toolrender.CompactOptions{}, true, false)
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
	compact := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)
	expanded := renderCommittedItem(item, toolrender.CompactOptions{}, true, false)

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
	compact := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)
	expanded := renderCommittedItem(item, toolrender.CompactOptions{}, true, false)
	assert.Equal(t, compact, expanded)
}

func TestBuildReCommitCmd_Expanded_ProducesCmd(t *testing.T) {
	items := []committedItem{
		{kind: kindHeader, header: &sessionHeaderInfo{SessionID: "ses-1"}},
		{kind: kindToolCompact, toolCalls: []toolrender.ToolCallInfo{
			{Name: "shell", Args: map[string]interface{}{"command": "ls"}, Status: "completed", Result: "a\nb\nc\nd\ne"},
		}},
	}
	rendered := renderHistoryBatch(items, toolrender.CompactOptions{}, true, false)
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
		{kind: kindSubAgentBlock, saBlock: &subAgentBlock{
			id: "sa-1", name: "researcher", subject: "Update tests",
			status: "completed", toolCount: 3,
			children: []committedItem{
				{kind: kindToolCompact, toolCalls: []toolrender.ToolCallInfo{{
					Name: "read_file", Args: map[string]interface{}{"path": "test.go"},
				}}, subAgentID: "sa-1"},
			},
		}},
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
			var lastKind committedKind
			for _, item := range items {
				text := renderCommittedItem(item, opts, expanded, false)
				if text == "" {
					continue
				}
				if !first {
					b.WriteByte('\n')
					if needsLeadingGap(lastKind, item.kind) {
						b.WriteByte('\n')
					}
				}
				b.WriteString(text)
				if item.kind == kindHeader {
					b.WriteByte('\n')
				}
				if needsTrailingGap(item.kind) {
					b.WriteByte('\n')
				}
				lastKind = item.kind
				first = false
			}
			expected := b.String()
			actual := renderHistoryBatch(items, opts, expanded, false)
			assert.Equal(t, expected, actual)
		})
	}
}

func TestRenderHistoryBatch_EmptyHistory(t *testing.T) {
	assert.Equal(t, "", renderHistoryBatch(nil, toolrender.CompactOptions{}, false, false))
	assert.Equal(t, "", renderHistoryBatch([]committedItem{}, toolrender.CompactOptions{}, false, false))
}

func TestRenderHistoryBatch_SingleItem(t *testing.T) {
	item := committedItem{kind: kindText, text: "only item"}
	result := renderHistoryBatch([]committedItem{item}, toolrender.CompactOptions{}, false, false)
	assert.Equal(t, "only item\n", result)
}

func TestRenderHistoryBatch_SkipsEmptyItems(t *testing.T) {
	items := []committedItem{
		{kind: kindText, text: "first"},
		{kind: kindToolCompact},
		{kind: kindText, text: "second"},
	}
	result := renderHistoryBatch(items, toolrender.CompactOptions{}, false, false)
	assert.Equal(t, "first\n\nsecond\n", result)
}

func TestRenderHistoryBatch_NilHeader(t *testing.T) {
	items := []committedItem{
		{kind: kindHeader},
		{kind: kindText, text: "after empty header"},
	}
	result := renderHistoryBatch(items, toolrender.CompactOptions{}, false, false)
	assert.Equal(t, "after empty header\n", result)
}

func TestRenderHistoryBatch_HeaderHasBlankLineGap(t *testing.T) {
	items := []committedItem{
		{kind: kindHeader, header: &sessionHeaderInfo{SessionID: "ses-1"}},
		{kind: kindText, text: "first content"},
	}
	result := renderHistoryBatch(items, toolrender.CompactOptions{}, false, false)

	headerText := renderCommittedItem(items[0], toolrender.CompactOptions{}, false, false)
	assert.Equal(t, headerText+"\n\nfirst content\n", result,
		"header should be followed by a blank line before the next item")
}

func TestRenderHistoryBatch_HeaderOnly_NoExtraNewline(t *testing.T) {
	items := []committedItem{
		{kind: kindHeader, header: &sessionHeaderInfo{SessionID: "ses-1"}},
	}
	result := renderHistoryBatch(items, toolrender.CompactOptions{}, false, false)

	headerText := renderCommittedItem(items[0], toolrender.CompactOptions{}, false, false)
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
		{kind: kindSubAgentBlock, saBlock: &subAgentBlock{
			id: "sa-1", name: "researcher", subject: "Update tests",
			status: "completed", toolCount: 3,
			children: []committedItem{
				{kind: kindToolCompact, toolCalls: []toolrender.ToolCallInfo{{
					Name: "read_file", Args: map[string]interface{}{"path": "test.go"},
				}}, subAgentID: "sa-1"},
			},
		}},
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

			batch := renderHistoryBatch(items, opts, expanded, false)

			assert.Equal(t, batch+"\n", liveOutput,
				"live commitToScrollback output should match renderHistoryBatch "+
					"(plus a trailing newline from the final statusf)")
		})
	}
}

func TestNeedsTrailingGap(t *testing.T) {
	// Default-true: most kinds get a trailing gap for consistent spacing.
	gapKinds := []committedKind{
		kindAIMessage, kindHumanMessage, kindSystemMessage,
		kindSubAgentBlock, kindPhaseChange,
		kindApproval, kindText,
	}
	for _, k := range gapKinds {
		assert.True(t, needsTrailingGap(k), "expected needsTrailingGap==true for kind %d", k)
	}

	// Explicit opt-outs only.
	noGapKinds := []committedKind{
		kindHeader, kindToolCompact, kindReadGroup, kindTodoUpdate, kindAIStreamLine,
	}
	for _, k := range noGapKinds {
		assert.False(t, needsTrailingGap(k), "expected needsTrailingGap==false for kind %d", k)
	}
}

func TestNeedsLeadingGap(t *testing.T) {
	tests := []struct {
		name     string
		prev     committedKind
		current  committedKind
		expected bool
	}{
		{"tool→tool: no gap", kindToolCompact, kindToolCompact, false},
		{"tool→readGroup: no gap", kindToolCompact, kindReadGroup, false},
		{"readGroup→tool: no gap", kindReadGroup, kindToolCompact, false},
		{"readGroup→readGroup: no gap", kindReadGroup, kindReadGroup, false},
		{"tool→AIMessage: gap", kindToolCompact, kindAIMessage, true},
		{"tool→text: gap", kindToolCompact, kindText, true},
		{"tool→approval: gap", kindToolCompact, kindApproval, true},
		{"readGroup→AIMessage: gap", kindReadGroup, kindAIMessage, true},
		{"readGroup→approval: gap", kindReadGroup, kindApproval, true},
		{"readGroup→AIStreamLine: gap", kindReadGroup, kindAIStreamLine, true},
		{"AIMessage→tool: no gap", kindAIMessage, kindToolCompact, false},
		{"AIMessage→AIMessage: no gap", kindAIMessage, kindAIMessage, false},
		{"header→AIMessage: no gap", kindHeader, kindAIMessage, false},
		{"text→tool: no gap", kindText, kindToolCompact, false},
		{"zero→tool: no gap", 0, kindToolCompact, false},
		{"zero→AIMessage: no gap", 0, kindAIMessage, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, needsLeadingGap(tt.prev, tt.current))
		})
	}
}

func TestLastKindFromHistory(t *testing.T) {
	t.Run("empty", func(t *testing.T) {
		assert.Equal(t, committedKind(0), lastKindFromHistory(nil))
	})
	t.Run("single item", func(t *testing.T) {
		items := []committedItem{{kind: kindHeader}}
		assert.Equal(t, kindHeader, lastKindFromHistory(items))
	})
	t.Run("skips trailing todoUpdate", func(t *testing.T) {
		items := []committedItem{
			{kind: kindAIMessage, text: "msg"},
			{kind: kindTodoUpdate, text: "plan"},
		}
		assert.Equal(t, kindAIMessage, lastKindFromHistory(items))
	})
	t.Run("all todoUpdates", func(t *testing.T) {
		items := []committedItem{
			{kind: kindTodoUpdate, text: "plan1"},
			{kind: kindTodoUpdate, text: "plan2"},
		}
		assert.Equal(t, committedKind(0), lastKindFromHistory(items))
	})
	t.Run("returns last non-todo", func(t *testing.T) {
		items := []committedItem{
			{kind: kindHeader},
			{kind: kindToolCompact},
			{kind: kindTodoUpdate},
		}
		assert.Equal(t, kindToolCompact, lastKindFromHistory(items))
	})
}

func TestRenderHistoryBatch_LeadingGapAfterTools(t *testing.T) {
	items := []committedItem{
		{kind: kindToolCompact, toolCalls: []toolrender.ToolCallInfo{{
			Name: "read_file", Args: map[string]interface{}{"path": "a.go"},
		}}},
		{kind: kindToolCompact, toolCalls: []toolrender.ToolCallInfo{{
			Name: "read_file", Args: map[string]interface{}{"path": "b.go"},
		}}},
		{kind: kindAIMessage, text: "Here is my analysis."},
	}
	result := renderHistoryBatch(items, toolrender.CompactOptions{}, false, false)

	tool1 := renderCommittedItem(items[0], toolrender.CompactOptions{}, false, false)
	tool2 := renderCommittedItem(items[1], toolrender.CompactOptions{}, false, false)

	assert.Contains(t, result, tool1+"\n"+tool2,
		"consecutive tools should stack tightly")
	assert.Contains(t, result, tool2+"\n\nHere is my analysis.",
		"a blank line should separate tools from the following AI message")
}

func TestWriteToScrollback_TracksLastKind(t *testing.T) {
	var buf bytes.Buffer
	r := &inlineRenderer{
		cfg: inlineRenderConfig{status: &buf},
	}

	r.writeToScrollback(kindToolCompact, "tool output")
	assert.Equal(t, kindToolCompact, r.lastScrollbackKind)

	r.writeToScrollback(kindAIStreamLine, "stream line")
	assert.Equal(t, kindAIStreamLine, r.lastScrollbackKind)

	r.writeToScrollback(kindAIMessage, "full message")
	assert.Equal(t, kindAIMessage, r.lastScrollbackKind)
}

func TestWriteToScrollback_EmptyTextNoOp(t *testing.T) {
	var buf bytes.Buffer
	r := &inlineRenderer{
		cfg:                inlineRenderConfig{status: &buf},
		lastScrollbackKind: kindToolCompact,
	}
	r.writeToScrollback(kindAIMessage, "")
	assert.Equal(t, kindToolCompact, r.lastScrollbackKind,
		"empty text should not update lastScrollbackKind")
	assert.Equal(t, "", buf.String())
}

func TestCommitStreamEndGap(t *testing.T) {
	var buf bytes.Buffer
	r := &inlineRenderer{
		cfg:                inlineRenderConfig{status: &buf},
		lastScrollbackKind: kindAIStreamLine,
	}
	r.commitStreamEndGap()
	assert.Equal(t, kindAIMessage, r.lastScrollbackKind,
		"commitStreamEndGap should set lastScrollbackKind to kindAIMessage")
	assert.Equal(t, "\n", buf.String(),
		"commitStreamEndGap should emit trailing gap for kindAIMessage")
}

// =============================================================================
// Sub-agent block rendering
// =============================================================================

func TestRenderSubAgentBlockItem_Collapsed(t *testing.T) {
	block := &subAgentBlock{
		id: "sa-1", name: "researcher", subject: "Explore CLI rendering",
		status: "completed", toolCount: 5,
	}
	item := committedItem{kind: kindSubAgentBlock, saBlock: block}

	result := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)

	assert.Contains(t, result, "Task")
	assert.Contains(t, result, "Explore CLI rendering")
	assert.Contains(t, result, "✓ Done")
	assert.Contains(t, result, "5 tools")
	assert.NotContains(t, result, "│", "collapsed view should not show gutter-wrapped children")
}

func TestRenderSubAgentBlockItem_Collapsed_Failed(t *testing.T) {
	block := &subAgentBlock{
		id: "sa-1", name: "researcher", subject: "Fix auth tests",
		status: "failed", toolCount: 3,
	}
	item := committedItem{kind: kindSubAgentBlock, saBlock: block}

	result := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)

	assert.Contains(t, result, "✗ Failed")
	assert.Contains(t, result, "3 tools")
}

func TestRenderSubAgentBlockItem_Expanded_ShowsChildren(t *testing.T) {
	block := &subAgentBlock{
		id: "sa-1", name: "researcher", subject: "Explore CLI rendering",
		status: "completed", toolCount: 2,
		children: []committedItem{
			{kind: kindToolCompact, subAgentID: "sa-1", toolCalls: []toolrender.ToolCallInfo{{
				Name: "read_file", Args: map[string]interface{}{"path": "main.go"},
			}}},
			{kind: kindToolCompact, subAgentID: "sa-1", toolCalls: []toolrender.ToolCallInfo{{
				Name: "shell", Args: map[string]interface{}{"command": "ls"},
			}}},
		},
	}
	item := committedItem{kind: kindSubAgentBlock, saBlock: block}

	result := renderCommittedItem(item, toolrender.CompactOptions{}, true, false)

	assert.Contains(t, result, "Task")
	assert.Contains(t, result, "Explore CLI rendering")
	assert.Contains(t, result, "│", "expanded view should show gutter-wrapped children")
	assert.Contains(t, result, "main.go")
	assert.Contains(t, result, "✓ Done")
}

func TestRenderSubAgentBlockItem_NilBlock(t *testing.T) {
	item := committedItem{kind: kindSubAgentBlock}
	result := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)
	assert.Equal(t, "", result)
}

func TestRenderSubAgentBlockItem_FallbackToName(t *testing.T) {
	block := &subAgentBlock{
		id: "sa-1", name: "code_editor", subject: "",
		status: "completed", toolCount: 1,
	}
	item := committedItem{kind: kindSubAgentBlock, saBlock: block}

	result := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)
	assert.Contains(t, result, "code_editor")
}

// =============================================================================
// Sub-agent block event routing
// =============================================================================

func TestAppendToSubAgentBlock_ToolCompletion(t *testing.T) {
	var buf bytes.Buffer
	r := &inlineRenderer{
		cfg:             inlineRenderConfig{status: &buf},
		activeSubAgents: make(map[string]*subAgentBlock),
	}

	block := &subAgentBlock{id: "sa-1", name: "researcher", subject: "test"}
	r.activeSubAgents["sa-1"] = block

	item := committedItem{
		kind:       kindToolCompact,
		subAgentID: "sa-1",
		toolCalls:  []toolrender.ToolCallInfo{{Name: "read_file"}},
	}
	r.appendToSubAgentBlock("sa-1", item, true)

	assert.Len(t, block.children, 1)
	assert.Equal(t, 1, block.toolCount)
	assert.Equal(t, "", buf.String(), "should not write to scrollback")
}

func TestAppendToSubAgentBlock_AIMessage(t *testing.T) {
	var buf bytes.Buffer
	r := &inlineRenderer{
		cfg:             inlineRenderConfig{status: &buf},
		activeSubAgents: make(map[string]*subAgentBlock),
	}

	block := &subAgentBlock{id: "sa-1", name: "researcher", subject: "test"}
	r.activeSubAgents["sa-1"] = block

	item := committedItem{
		kind:       kindAIMessage,
		text:       "intermediate reasoning",
		subAgentID: "sa-1",
	}
	r.appendToSubAgentBlock("sa-1", item, false)

	assert.Len(t, block.children, 1)
	assert.Equal(t, 0, block.toolCount, "AI messages should not increment tool count")
}

func TestFlushPendingReads_RoutesToSubAgentBlock(t *testing.T) {
	var buf bytes.Buffer
	r := &inlineRenderer{
		cfg:             inlineRenderConfig{status: &buf},
		activeSubAgents: make(map[string]*subAgentBlock),
	}

	block := &subAgentBlock{id: "sa-1", name: "researcher", subject: "test"}
	r.activeSubAgents["sa-1"] = block

	for i := 0; i < 3; i++ {
		r.pendingReads = append(r.pendingReads, pendingRead{
			tc:         toolrender.ToolCallInfo{Name: "read_file", Args: map[string]interface{}{"path": fmt.Sprintf("f%d.go", i)}},
			subAgentID: "sa-1",
		})
	}
	r.flushPendingReads()

	assert.Len(t, block.children, 1, "reads should be grouped as single child")
	assert.Equal(t, 3, block.toolCount)
	assert.Equal(t, "", buf.String(), "should not write to scrollback")
}

func TestHasActiveSubAgent(t *testing.T) {
	r := &inlineRenderer{
		activeSubAgents: make(map[string]*subAgentBlock),
	}

	assert.False(t, r.hasActiveSubAgent(""), "empty ID should return false")
	assert.False(t, r.hasActiveSubAgent("sa-1"), "unknown ID should return false")

	r.activeSubAgents["sa-1"] = &subAgentBlock{id: "sa-1"}
	assert.True(t, r.hasActiveSubAgent("sa-1"), "active ID should return true")
}

func TestRenderToolCompleted_RoutesToBlock(t *testing.T) {
	var buf bytes.Buffer
	r := &inlineRenderer{
		cfg:             inlineRenderConfig{status: &buf},
		activeSubAgents: make(map[string]*subAgentBlock),
	}

	block := &subAgentBlock{id: "sa-1", name: "researcher", subject: "test"}
	r.activeSubAgents["sa-1"] = block

	r.renderToolCompleted(executiontui.ToolCompletedEvent{
		SubAgentID: "sa-1",
		ToolCall:   toolrender.ToolCallInfo{Name: "shell", Args: map[string]interface{}{"command": "ls"}},
	})

	assert.Len(t, block.children, 1)
	assert.Equal(t, 1, block.toolCount)
	assert.Equal(t, "", buf.String(), "sub-agent tool should not write to scrollback")
}

func TestRenderToolCompleted_NoBlock_WritesToScrollback(t *testing.T) {
	var buf bytes.Buffer
	r := &inlineRenderer{
		cfg:             inlineRenderConfig{status: &buf},
		activeSubAgents: make(map[string]*subAgentBlock),
	}

	r.renderToolCompleted(executiontui.ToolCompletedEvent{
		ToolCall: toolrender.ToolCallInfo{Name: "shell", Args: map[string]interface{}{"command": "ls"}},
	})

	assert.NotEqual(t, "", buf.String(), "non-sub-agent tool should write to scrollback")
}

// =============================================================================
// Expand hint — "(ctrl+o to expand)" suffix
// =============================================================================

func TestAppendExpandHint_SingleLine(t *testing.T) {
	result := appendExpandHint("● Read main.go (43 lines)")
	assert.Contains(t, result, "● Read main.go (43 lines)")
	assert.Contains(t, result, "ctrl+o to expand")
}

func TestAppendExpandHint_MultiLine_FirstLineOnly(t *testing.T) {
	input := "● Read 3 files\n    main.go (125 lines)\n    config.go (43 lines)"
	result := appendExpandHint(input)

	lines := strings.SplitN(result, "\n", 2)
	assert.Contains(t, lines[0], "ctrl+o to expand",
		"hint should appear on the first line")
	assert.NotContains(t, lines[1], "ctrl+o to expand",
		"hint should NOT appear on subsequent lines")
}

func TestAppendExpandHint_EmptyString(t *testing.T) {
	assert.Equal(t, "", appendExpandHint(""))
}

func TestRenderCommittedItem_ExpandHint_ToolCompact(t *testing.T) {
	item := committedItem{
		kind: kindToolCompact,
		toolCalls: []toolrender.ToolCallInfo{{
			Name: "read_file",
			Args: map[string]interface{}{"path": "main.go"},
		}},
	}

	withHint := renderCommittedItem(item, toolrender.CompactOptions{}, false, true)
	assert.Contains(t, withHint, "ctrl+o to expand")

	withoutHint := renderCommittedItem(item, toolrender.CompactOptions{}, false, false)
	assert.NotContains(t, withoutHint, "ctrl+o to expand")
}

func TestRenderCommittedItem_ExpandHint_ReadGroup(t *testing.T) {
	reads := make([]toolrender.ToolCallInfo, readGroupThreshold)
	for i := range reads {
		reads[i] = toolrender.ToolCallInfo{
			Name:   "read_file",
			Args:   map[string]interface{}{"path": fmt.Sprintf("file_%d.go", i)},
			Status: "completed",
			Result: "content\n",
		}
	}
	item := committedItem{kind: kindReadGroup, toolCalls: reads}

	withHint := renderCommittedItem(item, toolrender.CompactOptions{}, false, true)
	assert.Contains(t, withHint, "ctrl+o to expand")

	lines := strings.SplitN(withHint, "\n", 2)
	assert.Contains(t, lines[0], "ctrl+o to expand",
		"hint should appear on the read group header line")
}

func TestRenderCommittedItem_ExpandHint_SubAgentBlock(t *testing.T) {
	block := &subAgentBlock{
		id: "sa-1", name: "researcher", subject: "Explore CLI code",
		status: "completed", toolCount: 5,
	}
	item := committedItem{kind: kindSubAgentBlock, saBlock: block}

	withHint := renderCommittedItem(item, toolrender.CompactOptions{}, false, true)
	assert.Contains(t, withHint, "ctrl+o to expand")
}

func TestRenderCommittedItem_NoHintWhenExpanded(t *testing.T) {
	item := committedItem{
		kind: kindToolCompact,
		toolCalls: []toolrender.ToolCallInfo{{
			Name:   "shell",
			Args:   map[string]interface{}{"command": "ls"},
			Status: "completed",
			Result: "file1\nfile2",
		}},
	}
	result := renderCommittedItem(item, toolrender.CompactOptions{}, true, true)
	assert.NotContains(t, result, "ctrl+o to expand",
		"hint should NOT appear in expanded mode even when showExpandHint is true")
}

func TestRenderCommittedItem_NoHintOnNonExpandableKinds(t *testing.T) {
	tests := []struct {
		name string
		item committedItem
	}{
		{"Header", committedItem{
			kind:   kindHeader,
			header: &sessionHeaderInfo{SessionID: "ses-1"},
		}},
		{"AIMessage", committedItem{kind: kindAIMessage, text: "response"}},
		{"HumanMessage", committedItem{kind: kindHumanMessage, text: "input"}},
		{"Approval", committedItem{
			kind: kindApproval, action: "approve",
			toolCalls: []toolrender.ToolCallInfo{{
				Name: "write_file",
				Args: map[string]interface{}{"path": "f.go"},
			}},
		}},
		{"Text", committedItem{kind: kindText, text: "plain text"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := renderCommittedItem(tt.item, toolrender.CompactOptions{}, false, true)
			assert.NotContains(t, result, "ctrl+o to expand",
				"non-expandable kind %q should not get hint", tt.name)
		})
	}
}

func TestExpandHintEnabled(t *testing.T) {
	t.Run("nil channel", func(t *testing.T) {
		r := &inlineRenderer{cfg: inlineRenderConfig{}}
		assert.False(t, r.expandHintEnabled())
	})
	t.Run("non-nil channel", func(t *testing.T) {
		ch := make(chan struct{}, 1)
		r := &inlineRenderer{cfg: inlineRenderConfig{toggleExpandCh: ch}}
		assert.True(t, r.expandHintEnabled())
	})
}

func TestRenderHistoryBatch_WithExpandHint(t *testing.T) {
	items := []committedItem{
		{kind: kindToolCompact, toolCalls: []toolrender.ToolCallInfo{{
			Name: "read_file", Args: map[string]interface{}{"path": "a.go"},
		}}},
		{kind: kindToolCompact, toolCalls: []toolrender.ToolCallInfo{{
			Name: "read_file", Args: map[string]interface{}{"path": "b.go"},
		}}},
	}

	withHint := renderHistoryBatch(items, toolrender.CompactOptions{}, false, true)
	assert.Contains(t, withHint, "ctrl+o to expand")

	withoutHint := renderHistoryBatch(items, toolrender.CompactOptions{}, false, false)
	assert.NotContains(t, withoutHint, "ctrl+o to expand")
}

func TestCommitToScrollback_WithExpandHint(t *testing.T) {
	ch := make(chan struct{}, 1)
	var buf bytes.Buffer
	r := &inlineRenderer{
		cfg:             inlineRenderConfig{status: &buf, toggleExpandCh: ch},
		activeSubAgents: make(map[string]*subAgentBlock),
	}

	item := committedItem{
		kind: kindToolCompact,
		toolCalls: []toolrender.ToolCallInfo{{
			Name: "read_file", Args: map[string]interface{}{"path": "main.go"},
		}},
	}
	r.commitToScrollback(item)

	assert.Contains(t, buf.String(), "ctrl+o to expand",
		"commitToScrollback should include hint when toggleExpandCh is set")
}

func TestCommitToScrollback_NoHintWithoutChannel(t *testing.T) {
	var buf bytes.Buffer
	r := &inlineRenderer{
		cfg:             inlineRenderConfig{status: &buf},
		activeSubAgents: make(map[string]*subAgentBlock),
	}

	item := committedItem{
		kind: kindToolCompact,
		toolCalls: []toolrender.ToolCallInfo{{
			Name: "read_file", Args: map[string]interface{}{"path": "main.go"},
		}},
	}
	r.commitToScrollback(item)

	assert.NotContains(t, buf.String(), "ctrl+o to expand",
		"commitToScrollback should NOT include hint when toggleExpandCh is nil")
}

package root

import (
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

func TestReCommitHistory_ProducesCmd(t *testing.T) {
	items := []committedItem{
		{kind: kindHeader, header: &sessionHeaderInfo{SessionID: "ses-1"}},
		{kind: kindText, text: "some output"},
		{kind: kindToolCompact, toolCalls: []toolrender.ToolCallInfo{
			{Name: "read_file", Args: map[string]interface{}{"path": "f.go"}},
		}},
	}
	cmd := reCommitHistory(items, toolrender.CompactOptions{}, false)
	assert.NotNil(t, cmd)
}

func TestReCommitHistory_EmptyHistory(t *testing.T) {
	cmd := reCommitHistory(nil, toolrender.CompactOptions{}, false)
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

func TestRenderCommittedItem_Expanded_HeaderUnchanged(t *testing.T) {
	item := committedItem{
		kind: kindHeader,
		header: &sessionHeaderInfo{
			SessionID: "ses-abc123",
			Subject:   "Test subject",
		},
	}
	compact := renderCommittedItem(item, toolrender.CompactOptions{}, false)
	expanded := renderCommittedItem(item, toolrender.CompactOptions{}, true)
	assert.Equal(t, compact, expanded)
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

func TestReCommitHistory_Expanded_ProducesCmd(t *testing.T) {
	items := []committedItem{
		{kind: kindHeader, header: &sessionHeaderInfo{SessionID: "ses-1"}},
		{kind: kindToolCompact, toolCalls: []toolrender.ToolCallInfo{
			{Name: "shell", Args: map[string]interface{}{"command": "ls"}, Status: "completed", Result: "a\nb\nc\nd\ne"},
		}},
	}
	cmd := reCommitHistory(items, toolrender.CompactOptions{}, true)
	assert.NotNil(t, cmd)
}

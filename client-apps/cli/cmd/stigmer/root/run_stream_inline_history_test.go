package root

import (
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
	result := renderCommittedItem(item, toolrender.CompactOptions{})

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
	result := renderCommittedItem(item, toolrender.CompactOptions{})

	assert.Contains(t, result, "ses-abc123")
	assert.NotContains(t, result, "Subject")
}

func TestRenderCommittedItem_Header_NilHeader(t *testing.T) {
	item := committedItem{kind: kindHeader}
	result := renderCommittedItem(item, toolrender.CompactOptions{})
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
	result := renderCommittedItem(item, toolrender.CompactOptions{})

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
	result := renderCommittedItem(item, toolrender.CompactOptions{})

	assert.Contains(t, result, "main.go")
	assert.Contains(t, result, "│")
}

func TestRenderCommittedItem_ToolCompact_Empty(t *testing.T) {
	item := committedItem{kind: kindToolCompact}
	assert.Equal(t, "", renderCommittedItem(item, toolrender.CompactOptions{}))
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
	result := renderCommittedItem(item, toolrender.CompactOptions{})

	assert.Contains(t, result, "Read")
}

func TestRenderCommittedItem_ReadGroup_Individual(t *testing.T) {
	reads := []toolrender.ToolCallInfo{
		{Name: "read_file", Args: map[string]interface{}{"path": "a.go"}},
		{Name: "read_file", Args: map[string]interface{}{"path": "b.go"}},
	}
	item := committedItem{kind: kindReadGroup, toolCalls: reads}
	result := renderCommittedItem(item, toolrender.CompactOptions{})

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
	result := renderCommittedItem(item, toolrender.CompactOptions{})

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
			result := renderCommittedItem(item, toolrender.CompactOptions{})
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
	cmd := reCommitHistory(items, toolrender.CompactOptions{})
	assert.NotNil(t, cmd)
}

func TestReCommitHistory_EmptyHistory(t *testing.T) {
	cmd := reCommitHistory(nil, toolrender.CompactOptions{})
	assert.NotNil(t, cmd)
}

func TestRenderCommittedItem_Header_SubjectMutation(t *testing.T) {
	info := sessionHeaderInfo{
		SessionID: "ses-abc123",
	}
	item := committedItem{kind: kindHeader, header: &info}

	before := renderCommittedItem(item, toolrender.CompactOptions{})
	assert.NotContains(t, before, "Subject")

	info.Subject = "Refactor auth module"
	after := renderCommittedItem(item, toolrender.CompactOptions{})
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
	result := renderCommittedItem(item, toolrender.CompactOptions{})
	assert.True(t, strings.HasSuffix(result, "\n"),
		"multi-line tool compact should end with blank line separator")
}

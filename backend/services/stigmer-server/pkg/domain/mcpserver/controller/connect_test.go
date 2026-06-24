package mcpserver

import (
	"encoding/json"
	"testing"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestConnectWorkflowOutput_DeserializesToolApprovals locks the exact contract
// that the historical gap broke: the connect workflow emits a `tool_approvals`
// key, and the Go output struct must have a field to receive it. Before the
// field existed, JSON deserialization silently dropped the key and OSS lost
// every classifier decision (layer 1 of the approval chain was always empty).
func TestConnectWorkflowOutput_DeserializesToolApprovals(t *testing.T) {
	// A representative payload mirroring the runner's ConnectMcpServerWorkflowOutput.
	payload := `{
		"tools": [
			{"name": "delete_repo", "description": "Delete a repository"},
			{"name": "search_code", "description": "Search code"}
		],
		"resource_templates": [],
		"tool_approvals": [
			{"tool_name": "delete_repo", "requires_approval": true, "message": "Delete repository {{args.repo}}"}
		]
	}`

	var out connectWorkflowOutput
	require.NoError(t, json.Unmarshal([]byte(payload), &out))

	require.Len(t, out.ToolApprovals, 1, "tool_approvals key must deserialize, not be silently dropped")
	assert.Equal(t, "delete_repo", out.ToolApprovals[0].ToolName)
	assert.True(t, out.ToolApprovals[0].RequiresApproval)
	assert.Equal(t, "Delete repository {{args.repo}}", out.ToolApprovals[0].Message)
}

func TestConvertToToolApprovals(t *testing.T) {
	tests := []struct {
		name string
		in   []toolApprovalResult
		want []*mcpserverv1.ToolApprovalPolicy
	}{
		{
			name: "nil input yields nil",
			in:   nil,
			want: nil,
		},
		{
			name: "gated tools are converted with message preserved",
			in: []toolApprovalResult{
				{ToolName: "delete_repo", RequiresApproval: true, Message: "Delete repository {{args.repo}}"},
				{ToolName: "send_email", RequiresApproval: true, Message: "Send email to {{args.to}}"},
			},
			want: []*mcpserverv1.ToolApprovalPolicy{
				{ToolName: "delete_repo", Message: "Delete repository {{args.repo}}"},
				{ToolName: "send_email", Message: "Send email to {{args.to}}"},
			},
		},
		{
			name: "requires_approval=false entries are skipped (presence == gated)",
			in: []toolApprovalResult{
				{ToolName: "search_code", RequiresApproval: false, Message: ""},
				{ToolName: "delete_repo", RequiresApproval: true, Message: "Delete"},
			},
			want: []*mcpserverv1.ToolApprovalPolicy{
				{ToolName: "delete_repo", Message: "Delete"},
			},
		},
		{
			name: "empty tool names are skipped defensively",
			in: []toolApprovalResult{
				{ToolName: "", RequiresApproval: true, Message: "no name"},
			},
			want: nil,
		},
		{
			name: "all-ungated input yields nil",
			in: []toolApprovalResult{
				{ToolName: "get_status", RequiresApproval: false},
				{ToolName: "list_items", RequiresApproval: false},
			},
			want: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := convertToToolApprovals(&connectWorkflowOutput{ToolApprovals: tt.in})
			require.Len(t, got, len(tt.want))
			for i := range tt.want {
				assert.Equal(t, tt.want[i].GetToolName(), got[i].GetToolName())
				assert.Equal(t, tt.want[i].GetMessage(), got[i].GetMessage())
			}
		})
	}
}

func TestSetToolApprovalsFromConnect(t *testing.T) {
	t.Run("non-empty result overwrites prior approvals", func(t *testing.T) {
		status := &mcpserverv1.McpServerStatus{
			ToolApprovals: []*mcpserverv1.ToolApprovalPolicy{{ToolName: "stale_tool", Message: "old"}},
		}
		out := &connectWorkflowOutput{ToolApprovals: []toolApprovalResult{
			{ToolName: "delete_repo", RequiresApproval: true, Message: "Delete"},
		}}

		count := setToolApprovalsFromConnect(status, out)

		assert.Equal(t, 1, count)
		require.Len(t, status.ToolApprovals, 1)
		assert.Equal(t, "delete_repo", status.ToolApprovals[0].GetToolName(),
			"reconnect with new classifications must replace the prior list")
	})

	t.Run("empty result preserves existing approvals (never wipe)", func(t *testing.T) {
		existing := []*mcpserverv1.ToolApprovalPolicy{{ToolName: "delete_repo", Message: "Delete"}}
		status := &mcpserverv1.McpServerStatus{ToolApprovals: existing}
		out := &connectWorkflowOutput{ToolApprovals: nil}

		count := setToolApprovalsFromConnect(status, out)

		assert.Equal(t, 0, count)
		require.Len(t, status.ToolApprovals, 1,
			"a degraded/older runner returning nothing must not disarm existing gates")
		assert.Equal(t, "delete_repo", status.ToolApprovals[0].GetToolName())
	})

	t.Run("result with only ungated tools preserves existing approvals", func(t *testing.T) {
		existing := []*mcpserverv1.ToolApprovalPolicy{{ToolName: "delete_repo", Message: "Delete"}}
		status := &mcpserverv1.McpServerStatus{ToolApprovals: existing}
		out := &connectWorkflowOutput{ToolApprovals: []toolApprovalResult{
			{ToolName: "search_code", RequiresApproval: false},
		}}

		count := setToolApprovalsFromConnect(status, out)

		assert.Equal(t, 0, count)
		require.Len(t, status.ToolApprovals, 1, "an all-ungated result is empty after conversion → preserve")
	})
}

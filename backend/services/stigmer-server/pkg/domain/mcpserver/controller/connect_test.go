package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
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

func TestBuildConnectFailureMessage(t *testing.T) {
	const cause = "unhandled errors in a TaskGroup (1 sub-exception)"

	stdioServer := &mcpserverv1.McpServer{
		Metadata: &apiresource.ApiResourceMetadata{Name: "Filesystem", Slug: "filesystem"},
		Spec: &mcpserverv1.McpServerSpec{
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{Command: "npx"},
			},
		},
	}
	httpServer := &mcpserverv1.McpServer{
		Metadata: &apiresource.ApiResourceMetadata{Name: "Remote API", Slug: "remote-api"},
		Spec: &mcpserverv1.McpServerSpec{
			ServerType: &mcpserverv1.McpServerSpec_Http{
				Http: &mcpserverv1.HttpServerConfig{Url: "https://example.com"},
			},
		},
	}

	t.Run("stdio message names the server, keeps the cause, and gives a local --dry-run hint", func(t *testing.T) {
		msg := buildConnectFailureMessage(stdioServer, cause)
		assert.Contains(t, msg, "Filesystem", "names the server")
		assert.Contains(t, msg, cause, "preserves the root cause")
		assert.Contains(t, msg, "stdio server", "identifies the transport")
		assert.Contains(t, msg, "stigmer connect mcp-server filesystem --dry-run",
			"points at the locally-runnable preview command with the server slug")
	})

	t.Run("http message uses reachability guidance, not the stdio hint", func(t *testing.T) {
		msg := buildConnectFailureMessage(httpServer, cause)
		assert.Contains(t, msg, "Remote API", "names the server")
		assert.Contains(t, msg, cause, "preserves the root cause")
		assert.Contains(t, msg, "reachable", "mentions reachability")
		assert.NotContains(t, msg, "--dry-run", "http guidance must not suggest the stdio preview")
	})

	t.Run("an OAuth-required cause passes through verbatim, without the generic suffix", func(t *testing.T) {
		// The runner emits a complete, actionable message for a 401 OAuth
		// challenge; wrapping it with "check your credentials" would contradict
		// it. The "requires OAuth" marker triggers the passthrough.
		const oauthCause = "MCP server 'notion' requires OAuth: its endpoint " +
			"returned an authentication challenge (HTTP 401). A manually-entered " +
			"API token will not work here — connect it with the OAuth \"Sign in\" flow instead."

		msg := buildConnectFailureMessage(httpServer, oauthCause)
		assert.Equal(t, oauthCause, msg, "the OAuth-required message is surfaced verbatim")
		assert.NotContains(t, msg, "reachable",
			"must not append the generic reachability suffix over an OAuth message")
	})
}

// newTestController returns an McpServerController backed by a fresh temp SQLite
// store, so persistConnectResult exercises the real atomic UpdateResource path.
func newTestController(t *testing.T) (*McpServerController, store.Store) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.sqlite")
	s, err := sqlite.NewStore(dbPath)
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })
	return NewMcpServerController(s), s
}

// seedMcpServer persists a minimal McpServer with the given pre-existing status.
func seedMcpServer(t *testing.T, ctx context.Context, s store.Store, id string, status *mcpserverv1.McpServerStatus) {
	t.Helper()
	server := &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata:   &apiresource.ApiResourceMetadata{Id: id, Name: id, Org: "test-org"},
		Spec:       &mcpserverv1.McpServerSpec{Description: "seed"},
		Status:     status,
	}
	require.NoError(t, s.SaveResource(ctx, apiresourcekind.ApiResourceKind_mcp_server, id, server))
}

func TestPersistConnectResult(t *testing.T) {
	ctx := context.Background()

	sampleOutput := &connectWorkflowOutput{
		Tools: []discoveredToolResult{
			{Name: "delete_repo", Description: "Delete a repository"},
			{Name: "search_code", Description: "Search code"},
		},
		ResourceTemplates: []discoveredResourceTemplateResult{
			{URITemplate: "repo://{owner}/{name}", Name: "repo", Description: "A repo", MimeType: "application/json"},
		},
		ToolApprovals: []toolApprovalResult{
			{ToolName: "delete_repo", RequiresApproval: true, Message: "Delete repository {{args.repo}}"},
		},
	}

	t.Run("persists capabilities and tool approvals; returned resource matches the store", func(t *testing.T) {
		c, s := newTestController(t)
		seedMcpServer(t, ctx, s, "srv-1", nil)

		persisted, count, err := c.persistConnectResult(ctx, "srv-1", "wf-1", sampleOutput)
		require.NoError(t, err)
		assert.Equal(t, 1, count)

		caps := persisted.GetStatus().GetDiscoveredCapabilities()
		require.NotNil(t, caps)
		assert.Len(t, caps.GetTools(), 2, "both discovered tools must be persisted")
		assert.Len(t, caps.GetResourceTemplates(), 1, "resource templates must be persisted")
		assert.NotNil(t, caps.GetLastDiscoveredAt(), "snapshot timestamp must be set")
		require.Len(t, persisted.GetStatus().GetToolApprovals(), 1)
		assert.Equal(t, "delete_repo", persisted.GetStatus().GetToolApprovals()[0].GetToolName())

		// The returned resource must equal what an independent read sees.
		stored := &mcpserverv1.McpServer{}
		require.NoError(t, s.GetResource(ctx, apiresourcekind.ApiResourceKind_mcp_server, "srv-1", stored))
		assert.Len(t, stored.GetStatus().GetDiscoveredCapabilities().GetTools(), 2)
		require.Len(t, stored.GetStatus().GetToolApprovals(), 1)
		assert.Equal(t, "delete_repo", stored.GetStatus().GetToolApprovals()[0].GetToolName())
	})

	t.Run("nil prior status gets a status created", func(t *testing.T) {
		c, s := newTestController(t)
		seedMcpServer(t, ctx, s, "srv-nil", nil)

		persisted, count, err := c.persistConnectResult(ctx, "srv-nil", "wf-nil", &connectWorkflowOutput{})
		require.NoError(t, err)
		assert.Equal(t, 0, count)
		require.NotNil(t, persisted.GetStatus(), "an empty connect result must still create a status")
		// Capabilities are overwrite-always, so even an empty result records a
		// (zero-tool) snapshot; no approvals are produced.
		assert.NotNil(t, persisted.GetStatus().GetDiscoveredCapabilities())
		assert.Empty(t, persisted.GetStatus().GetToolApprovals())
	})

	t.Run("empty approvals preserve prior gates but capabilities are refreshed", func(t *testing.T) {
		c, s := newTestController(t)
		seedMcpServer(t, ctx, s, "srv-2", &mcpserverv1.McpServerStatus{
			ToolApprovals: []*mcpserverv1.ToolApprovalPolicy{{ToolName: "delete_repo", Message: "Delete"}},
		})

		// A degraded/older runner returns refreshed tools but no approvals.
		out := &connectWorkflowOutput{
			Tools:         []discoveredToolResult{{Name: "search_code", Description: "Search"}},
			ToolApprovals: nil,
		}
		persisted, count, err := c.persistConnectResult(ctx, "srv-2", "wf-2", out)
		require.NoError(t, err)
		assert.Equal(t, 0, count)

		require.Len(t, persisted.GetStatus().GetToolApprovals(), 1,
			"safety-critical gates must never be disarmed by an empty result")
		assert.Equal(t, "delete_repo", persisted.GetStatus().GetToolApprovals()[0].GetToolName())
		require.Len(t, persisted.GetStatus().GetDiscoveredCapabilities().GetTools(), 1,
			"capabilities are overwrite-always — the snapshot must refresh")
		assert.Equal(t, "search_code", persisted.GetStatus().GetDiscoveredCapabilities().GetTools()[0].GetName())
	})

	t.Run("non-empty approvals overwrite prior gates", func(t *testing.T) {
		c, s := newTestController(t)
		seedMcpServer(t, ctx, s, "srv-3", &mcpserverv1.McpServerStatus{
			ToolApprovals: []*mcpserverv1.ToolApprovalPolicy{{ToolName: "stale_tool", Message: "old"}},
		})

		persisted, count, err := c.persistConnectResult(ctx, "srv-3", "wf-3", sampleOutput)
		require.NoError(t, err)
		assert.Equal(t, 1, count)
		require.Len(t, persisted.GetStatus().GetToolApprovals(), 1)
		assert.Equal(t, "delete_repo", persisted.GetStatus().GetToolApprovals()[0].GetToolName(),
			"a reconnect with new classifications must replace the prior list")
	})

	t.Run("returns store.ErrNotFound when the resource is absent (deleted mid-flight)", func(t *testing.T) {
		c, _ := newTestController(t)
		_, _, err := c.persistConnectResult(ctx, "does-not-exist", "wf-x", sampleOutput)
		require.Error(t, err)
		assert.True(t, errors.Is(err, store.ErrNotFound),
			"a deleted/absent resource must surface store.ErrNotFound so callers can skip; got: %v", err)
	})
}

// TestConnectTimeout_CoversRunnerColdStartBudget pins the connect workflow's
// total budget against the runner bounds it is derived from (issue #243). The
// runner grants stdio servers a 270s init allowance (STDIO_INIT_TIMEOUT_MS in
// activities/discover-mcp-server.ts) and classification a 120s floor
// (classifyWithTimeout in workflows/connect-mcp-server.ts); the workflow-level
// budget must exceed their sum or the allowance — and its actionable timeout
// error — is unreachable by construction, which is exactly how the pre-#243
// 45s value killed every heavy stdio connect. The literals here restate the
// runner's values deliberately: if either side moves, this test forces the
// derivation comment on connectTimeout to be revisited rather than silently
// drifting. (The runner pins its half in discover-mcp-server.test.ts.)
func TestConnectTimeout_CoversRunnerColdStartBudget(t *testing.T) {
	const (
		runnerStdioInitAllowance  = 270 * time.Second
		runnerClassificationFloor = 120 * time.Second
	)

	assert.Greater(t, int64(connectTimeout), int64(runnerStdioInitAllowance+runnerClassificationFloor),
		"connectTimeout must exceed the runner's stdio cold-start allowance + classification floor, "+
			"or heavy stdio connects die at the workflow ceiling before the runner's actionable error can fire")
	assert.Equal(t, 420*time.Second, connectTimeout,
		"connectTimeout is a user-facing wait ceiling — change it deliberately (update the derivation comment) rather than incidentally")
}

package mcpserver

import (
	"context"
	"testing"
	"time"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// These tests pin the connect_status bookkeeping — the observable contract of
// the async connect lane (stigmer/stigmer#425). The Temporal-facing halves
// (start-or-attach, await) are covered by the integration suite; everything
// here runs against the real SQLite store so the atomic read-modify-write
// paths are exercised, not mocked.

func TestPersistConnectStarting(t *testing.T) {
	ctx := context.Background()

	t.Run("records CONNECTING with handle, start time, and warning", func(t *testing.T) {
		c, s := newTestController(t)
		seedMcpServer(t, ctx, s, "srv-start", nil)

		persisted, err := c.persistConnectStarting(ctx, "srv-start", "wf-abc", "no runner polling")
		require.NoError(t, err)

		cs := persisted.GetStatus().GetConnectStatus()
		require.NotNil(t, cs)
		assert.Equal(t, mcpserverv1.ConnectPhase_connect_phase_connecting, cs.GetPhase())
		assert.Equal(t, "wf-abc", cs.GetWorkflowId())
		assert.NotNil(t, cs.GetStartedAt())
		assert.Nil(t, cs.GetFinishedAt(), "a starting operation has not finished")
		assert.Equal(t, "no runner polling", cs.GetWarning())

		// The returned resource must equal what an independent read sees.
		stored := &mcpserverv1.McpServer{}
		require.NoError(t, s.GetResource(ctx, apiresourcekind.ApiResourceKind_mcp_server, "srv-start", stored))
		assert.Equal(t, mcpserverv1.ConnectPhase_connect_phase_connecting, stored.GetStatus().GetConnectStatus().GetPhase())
	})

	t.Run("replaces the previous operation's record entirely", func(t *testing.T) {
		c, s := newTestController(t)
		seedMcpServer(t, ctx, s, "srv-restart", &mcpserverv1.McpServerStatus{
			ConnectStatus: &mcpserverv1.ConnectStatus{
				Phase:          mcpserverv1.ConnectPhase_connect_phase_failed,
				WorkflowId:     "wf-old",
				StartedAt:      timestamppb.New(time.Now().Add(-time.Hour)),
				FinishedAt:     timestamppb.New(time.Now().Add(-time.Hour)),
				FailureCode:    "INTERNAL",
				FailureMessage: "boom",
			},
		})

		persisted, err := c.persistConnectStarting(ctx, "srv-restart", "wf-new", "")
		require.NoError(t, err)

		cs := persisted.GetStatus().GetConnectStatus()
		assert.Equal(t, mcpserverv1.ConnectPhase_connect_phase_connecting, cs.GetPhase())
		assert.Equal(t, "wf-new", cs.GetWorkflowId())
		assert.Nil(t, cs.GetFinishedAt(), "the prior operation's finish time must not leak into the new one")
		assert.Empty(t, cs.GetFailureCode(), "the prior operation's failure must not leak into the new one")
		assert.Empty(t, cs.GetFailureMessage())
	})

	t.Run("does not disturb discovered capabilities or tool approvals", func(t *testing.T) {
		c, s := newTestController(t)
		seedMcpServer(t, ctx, s, "srv-keep", &mcpserverv1.McpServerStatus{
			DiscoveredCapabilities: &mcpserverv1.DiscoveredCapabilities{
				Tools: []*mcpserverv1.DiscoveredTool{{Name: "search_code"}},
			},
			ToolApprovals: []*mcpserverv1.ToolApprovalPolicy{{ToolName: "delete_repo", Message: "Delete"}},
		})

		persisted, err := c.persistConnectStarting(ctx, "srv-keep", "wf-1", "")
		require.NoError(t, err)
		assert.Len(t, persisted.GetStatus().GetDiscoveredCapabilities().GetTools(), 1,
			"a reconnect in progress must not wipe the last good snapshot")
		assert.Len(t, persisted.GetStatus().GetToolApprovals(), 1,
			"a reconnect in progress must never disarm approval gates")
	})
}

func TestPersistConnectResult_SettlesConnectStatus(t *testing.T) {
	ctx := context.Background()
	c, s := newTestController(t)
	seedMcpServer(t, ctx, s, "srv-settle", &mcpserverv1.McpServerStatus{
		ConnectStatus: &mcpserverv1.ConnectStatus{
			Phase:      mcpserverv1.ConnectPhase_connect_phase_connecting,
			WorkflowId: "wf-settle",
			StartedAt:  timestamppb.Now(),
			Warning:    "no runner polling",
		},
	})

	persisted, _, err := c.persistConnectResult(ctx, "srv-settle", "wf-settle", &connectWorkflowOutput{
		Tools: []discoveredToolResult{{Name: "search_code"}},
	})
	require.NoError(t, err)

	cs := persisted.GetStatus().GetConnectStatus()
	require.NotNil(t, cs)
	assert.Equal(t, mcpserverv1.ConnectPhase_connect_phase_succeeded, cs.GetPhase())
	assert.Equal(t, "wf-settle", cs.GetWorkflowId())
	assert.NotNil(t, cs.GetStartedAt(), "the start time recorded by the starting lane must survive the settle")
	assert.NotNil(t, cs.GetFinishedAt())
	assert.Empty(t, cs.GetWarning(), "a settled operation has disproven the start-time advisory")
	assert.Empty(t, cs.GetFailureCode())

	// Results and terminal phase land in ONE atomic write: the stored resource
	// carries both, so a poller can never see one without the other.
	stored := &mcpserverv1.McpServer{}
	require.NoError(t, s.GetResource(ctx, apiresourcekind.ApiResourceKind_mcp_server, "srv-settle", stored))
	assert.Equal(t, mcpserverv1.ConnectPhase_connect_phase_succeeded, stored.GetStatus().GetConnectStatus().GetPhase())
	assert.Len(t, stored.GetStatus().GetDiscoveredCapabilities().GetTools(), 1)
}

func TestPersistConnectResult_SettlesEvenWithoutPriorRecord(t *testing.T) {
	// A lane whose CONNECTING write failed (or a legacy in-flight run from
	// before connect_status existed) must still produce a terminal record.
	ctx := context.Background()
	c, s := newTestController(t)
	seedMcpServer(t, ctx, s, "srv-norec", nil)

	persisted, _, err := c.persistConnectResult(ctx, "srv-norec", "wf-late", &connectWorkflowOutput{})
	require.NoError(t, err)

	cs := persisted.GetStatus().GetConnectStatus()
	require.NotNil(t, cs, "settling must create the record when the starting write never landed")
	assert.Equal(t, mcpserverv1.ConnectPhase_connect_phase_succeeded, cs.GetPhase())
	assert.Equal(t, "wf-late", cs.GetWorkflowId())
}

func TestPersistConnectFailure(t *testing.T) {
	ctx := context.Background()

	t.Run("records the mapped gRPC classification verbatim", func(t *testing.T) {
		c, s := newTestController(t)
		seedMcpServer(t, ctx, s, "srv-fail", &mcpserverv1.McpServerStatus{
			ConnectStatus: &mcpserverv1.ConnectStatus{
				Phase:      mcpserverv1.ConnectPhase_connect_phase_connecting,
				WorkflowId: "wf-fail",
				StartedAt:  timestamppb.Now(),
			},
		})

		c.persistConnectFailure(ctx, "srv-fail",
			status.Error(codes.FailedPrecondition, "connect failed for MCP server 'x': missing credentials"))

		stored := &mcpserverv1.McpServer{}
		require.NoError(t, s.GetResource(ctx, apiresourcekind.ApiResourceKind_mcp_server, "srv-fail", stored))
		cs := stored.GetStatus().GetConnectStatus()
		assert.Equal(t, mcpserverv1.ConnectPhase_connect_phase_failed, cs.GetPhase())
		assert.Equal(t, "wf-fail", cs.GetWorkflowId(), "the recorded handle survives the settle")
		assert.Equal(t, "FailedPrecondition", cs.GetFailureCode())
		assert.Contains(t, cs.GetFailureMessage(), "missing credentials",
			"polling clients must get the same user-facing text blocking callers get as an RPC error")
		assert.NotNil(t, cs.GetFinishedAt())
	})

	t.Run("swallows a deleted resource (expected mid-operation case)", func(t *testing.T) {
		c, _ := newTestController(t)
		// Must not panic or propagate — the failure was already surfaced on
		// the caller's own channel.
		c.persistConnectFailure(ctx, "gone", grpclib.InternalError(nil, "late failure"))
	})

	t.Run("preserves the last good results alongside the failure", func(t *testing.T) {
		c, s := newTestController(t)
		seedMcpServer(t, ctx, s, "srv-keepres", &mcpserverv1.McpServerStatus{
			DiscoveredCapabilities: &mcpserverv1.DiscoveredCapabilities{
				Tools: []*mcpserverv1.DiscoveredTool{{Name: "search_code"}},
			},
			ConnectStatus: &mcpserverv1.ConnectStatus{
				Phase: mcpserverv1.ConnectPhase_connect_phase_connecting,
			},
		})

		c.persistConnectFailure(ctx, "srv-keepres", status.Error(codes.DeadlineExceeded, "budget elapsed"))

		stored := &mcpserverv1.McpServer{}
		require.NoError(t, s.GetResource(ctx, apiresourcekind.ApiResourceKind_mcp_server, "srv-keepres", stored))
		assert.Len(t, stored.GetStatus().GetDiscoveredCapabilities().GetTools(), 1,
			"a failed reconnect must not wipe the last good snapshot")
		assert.Equal(t, mcpserverv1.ConnectPhase_connect_phase_failed, stored.GetStatus().GetConnectStatus().GetPhase())
	})
}

// TestAsyncConnectTimeout_StaysAboveBlockingCeiling pins the async lane's
// backstop against the budgets it must cover (see the derivation comment on
// asyncConnectTimeout): the discovery activity's 600s hard bound plus two
// classification attempts for servers up to ~800 tools,
// max(120, (800/40+1)*60)s = 1260s each. If the runner's budget formula moves,
// this forces the derivation to be revisited rather than silently drifting —
// the same pin discipline as TestConnectTimeout_CoversRunnerColdStartBudget.
func TestAsyncConnectTimeout_StaysAboveBlockingCeiling(t *testing.T) {
	const (
		runnerDiscoveryBound          = 600 * time.Second
		classificationAttempt800Tools = 1260 * time.Second
		classificationMaximumAttempts = 2
	)

	assert.Greater(t,
		int64(asyncConnectTimeout),
		int64(runnerDiscoveryBound+classificationMaximumAttempts*classificationAttempt800Tools),
		"asyncConnectTimeout must cover discovery plus two classification attempts for ~800-tool servers")
	assert.Equal(t, 60*time.Minute, asyncConnectTimeout,
		"asyncConnectTimeout is the async lane's backstop — change it deliberately (update the derivation comment) rather than incidentally")
}

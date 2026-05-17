package harness

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	executionctxv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stretchr/testify/require"
)

// HarnessConfig describes one execution harness for table-driven subtests.
// Every agent execution test iterates over Harnesses and runs t.Run(h.Name, ...).
type HarnessConfig struct {
	Name    string
	Harness sessionv1.Harness
	Skip    func(t *testing.T, th *TestHarness)
}

// Harnesses is the canonical list used by all cross-harness agent execution tests.
var Harnesses = []HarnessConfig{
	{
		Name:    "native",
		Harness: sessionv1.Harness_HARNESS_NATIVE,
		Skip:    RequireNativePrereqs,
	},
	{
		Name:    "cursor",
		Harness: sessionv1.Harness_HARNESS_CURSOR,
		Skip:    RequireCursorPrereqs,
	},
}

// RequireNativePrereqs skips the test if the native (Graphton) agent-runner
// is not available. Requires both workflow-runner and agent-runner.
func RequireNativePrereqs(t *testing.T, th *TestHarness) {
	t.Helper()
	if th.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
	}
	if th.AgentRunner == nil {
		t.Skip("agent-runner not available — skipping native harness test")
	}
}

// RequireCursorPrereqs skips the test if the Cursor runner is not available.
func RequireCursorPrereqs(t *testing.T, th *TestHarness) {
	t.Helper()
	if th.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
	}
	if th.CursorRunner == nil {
		t.Skip("cursor-runner not available — skipping cursor harness test")
	}
}

// SkipCursorForHITLGate skips cursor harness subtests that require the runner to
// block on WAITING_FOR_APPROVAL. The cursor harness auto-executes MCP tools in
// integration tests without surfacing the approval gate.
func SkipCursorForHITLGate(t *testing.T, h HarnessConfig) {
	t.Helper()
	if h.Harness == sessionv1.Harness_HARNESS_CURSOR {
		t.Skip("cursor harness does not block MCP tools on approval gate in integration tests")
	}
}

// SessionOption configures a SessionSpec before creation.
type SessionOption func(*sessionv1.SessionSpec)

// WithCursorMode sets an explicit CursorMode on the session, overriding
// the cursor-runner's auto-detection from workspace entries.
func WithCursorMode(mode sessionv1.CursorMode) SessionOption {
	return func(s *sessionv1.SessionSpec) {
		s.CursorMode = mode
	}
}

// WithWorkspaceEntries sets workspace entries on the session spec.
// Cloud cursor mode requires at least one git repo entry.
func WithWorkspaceEntries(entries []*sessionv1.WorkspaceEntry) SessionOption {
	return func(s *sessionv1.SessionSpec) {
		s.WorkspaceEntries = entries
	}
}

// CreateTestSession creates a session for agent execution tests with the
// specified harness. The session is deleted on test cleanup.
func CreateTestSession(t *testing.T, ctx context.Context, clients *Clients, agentInstanceID string, harness sessionv1.Harness, opts ...SessionOption) *sessionv1.Session {
	t.Helper()

	session := &sessionv1.Session{
		ApiVersion: testAPIVersion,
		Kind:       "Session",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-session-" + uuid.New().String()[:8],
			Org:  testOrg,
		},
		Spec: &sessionv1.SessionSpec{
			AgentInstanceId: agentInstanceID,
			Subject:         "integration test session",
			Harness:         harness,
		},
	}
	for _, opt := range opts {
		opt(session.Spec)
	}

	created, err := clients.SessionCommand.Create(ctx, session)
	require.NoError(t, err, "create session should succeed")
	require.NotEmpty(t, created.GetMetadata().GetId(), "session should have an ID")

	t.Logf("created session: id=%s, harness=%s, cursor_mode=%s",
		created.GetMetadata().GetId(), harness.String(), created.GetSpec().GetCursorMode().String())

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := clients.SessionCommand.Delete(cleanCtx, &sessionv1.SessionId{Value: created.GetMetadata().GetId()})
		if err != nil {
			t.Logf("warning: failed to clean up session %s: %v", created.GetMetadata().GetId(), err)
		}
	})

	return created
}

// CreateTestAgentExecution creates an agent execution in the specified session.
// The execution is not cleaned up automatically — it is owned by the session.
func CreateTestAgentExecution(t *testing.T, ctx context.Context, clients *Clients, sessionID, message string, opts ...AgentExecutionOption) *agentexecv1.AgentExecution {
	t.Helper()

	spec := &agentexecv1.AgentExecutionSpec{
		SessionId: sessionID,
		Message:   message,
	}
	for _, opt := range opts {
		opt(spec)
	}

	exec := &agentexecv1.AgentExecution{
		ApiVersion: testAPIVersion,
		Kind:       "AgentExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-exec-" + uuid.New().String()[:8],
			Org:  testOrg,
		},
		Spec: spec,
	}

	created, err := clients.AgentExecutionCommand.Create(ctx, exec)
	require.NoError(t, err, "create agent execution should succeed")
	require.NotEmpty(t, created.GetMetadata().GetId(), "execution should have an ID")

	t.Logf("created agent execution: id=%s, session=%s", created.GetMetadata().GetId(), sessionID)

	return created
}

// AgentExecutionOption configures an AgentExecutionSpec before creation.
type AgentExecutionOption func(*agentexecv1.AgentExecutionSpec)

// WithAutoApproveAll sets auto_approve_all on the execution.
func WithAutoApproveAll(v bool) AgentExecutionOption {
	return func(s *agentexecv1.AgentExecutionSpec) {
		s.AutoApproveAll = v
	}
}

// WithExecutionConfig sets the execution config (model, cost cap, etc.).
func WithExecutionConfig(cfg *agentexecv1.ExecutionConfig) AgentExecutionOption {
	return func(s *agentexecv1.AgentExecutionSpec) {
		s.ExecutionConfig = cfg
	}
}

// WithAgentID sets the agent_id on the execution spec (for session-less creation).
func WithAgentID(agentID string) AgentExecutionOption {
	return func(s *agentexecv1.AgentExecutionSpec) {
		s.AgentId = agentID
	}
}

// WithRuntimeEnv sets runtime environment variables on the execution spec.
func WithRuntimeEnv(env map[string]*executionctxv1.ExecutionValue) AgentExecutionOption {
	return func(s *agentexecv1.AgentExecutionSpec) {
		s.RuntimeEnv = env
	}
}

// RequireServiceHealthy skips the test if the Java service gRPC connection
// is not responding. Useful as a guard before expensive test families to
// avoid cascading failures when the service has crashed.
func RequireServiceHealthy(t *testing.T, ctx context.Context, clients *Clients) {
	t.Helper()
	probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	_, err := clients.AgentExecutionQuery.List(probeCtx, &agentexecv1.ListAgentExecutionsRequest{
		PageSize: 1,
	})
	if err != nil {
		t.Skipf("Java service not healthy — skipping: %v", err)
	}
}

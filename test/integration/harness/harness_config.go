package harness

import (
	"context"
	"os"
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

// RequireNativePrereqs skips the test if the unified runner is not available
// or if the Anthropic API key is absent. Every native harness test dispatches
// an agent execution through the LLM proxy, which requires an upstream key.
// Without it, executions hang until the test context expires (~4 min), causing
// a panic that aborts the entire suite.
func RequireNativePrereqs(t *testing.T, th *TestHarness) {
	t.Helper()
	if th.UnifiedRunner == nil {
		t.Skip("unified runner not available — skipping native harness test")
	}
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		t.Skip("ANTHROPIC_API_KEY not set — skipping native harness test (requires LLM)")
	}
}

// RequireCursorPrereqs skips the test if the unified runner is not available
// or if the Cursor API key is absent. Every cursor harness test dispatches
// an agent execution through the Cursor proxy, which requires an upstream key.
// Without it, executions fail immediately with HTTP 502 from the proxy.
func RequireCursorPrereqs(t *testing.T, th *TestHarness) {
	t.Helper()
	if th.UnifiedRunner == nil {
		t.Skip("unified runner not available — skipping cursor harness test")
	}
	if os.Getenv("CURSOR_API_KEY") == "" {
		t.Skip("CURSOR_API_KEY not set — skipping cursor harness test (requires Cursor proxy)")
	}
}

// SkipCursorForHITLGate skips the MCP-tool HITL subtests for the cursor harness.
//
// The cursor harness now enforces the approval gate (the preToolUse hook loads
// once "project" setting sources are enabled, and built-in mutating tools are
// gated). The built-in approval loop is covered end-to-end by
// TestCursorHarness_HITL_WriteGate_Approve.
//
// These MCP-tool subtests remain skipped pending live confirmation that Cursor's
// preToolUse hook surfaces MCP tool calls by their real name (so the policy
// lookup matches) and reports a denied MCP tool as a tool_call "error" event the
// runner can turn into a pending approval. Until that is verified against the
// live Cursor SDK, gating MCP tools specifically is unconfirmed.
func SkipCursorForHITLGate(t *testing.T, h HarnessConfig) {
	t.Helper()
	if h.Harness == sessionv1.Harness_HARNESS_CURSOR {
		t.Skip("cursor harness MCP-tool approval gate pending live preToolUse verification (built-in gate covered by TestCursorHarness_HITL_WriteGate_Approve)")
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

// WithSubject sets an explicit subject on the session spec.
func WithSubject(subject string) SessionOption {
	return func(s *sessionv1.SessionSpec) {
		s.Subject = subject
	}
}

// WithExecutionTarget sets the execution target on the session spec.
func WithExecutionTarget(target sessionv1.ExecutionTarget) SessionOption {
	return func(s *sessionv1.SessionSpec) {
		s.ExecutionTarget = target
	}
}

// SessionResourceOption applies to the full Session resource (metadata + spec).
type SessionResourceOption func(*sessionv1.Session)

// WithSessionOrg overrides the org on the session metadata (defaults to TestOrg).
func WithSessionOrg(org string) SessionResourceOption {
	return func(s *sessionv1.Session) {
		s.Metadata.Org = org
	}
}

// CreateTestSession creates a session for agent execution tests with the
// specified harness. The session is deleted on test cleanup.
func CreateTestSession(t *testing.T, ctx context.Context, clients *Clients, agentInstanceID string, harness sessionv1.Harness, opts ...SessionOption) *sessionv1.Session {
	t.Helper()
	return createTestSessionInternal(t, ctx, clients, agentInstanceID, harness, opts, nil)
}

// CreateTestSessionWithOrg creates a session under a specific org.
func CreateTestSessionWithOrg(t *testing.T, ctx context.Context, clients *Clients, agentInstanceID string, harness sessionv1.Harness, resOpts []SessionResourceOption, opts ...SessionOption) *sessionv1.Session {
	t.Helper()
	return createTestSessionInternal(t, ctx, clients, agentInstanceID, harness, opts, resOpts)
}

func createTestSessionInternal(t *testing.T, ctx context.Context, clients *Clients, agentInstanceID string, harness sessionv1.Harness, opts []SessionOption, resOpts []SessionResourceOption) *sessionv1.Session {
	t.Helper()

	session := &sessionv1.Session{
		ApiVersion: TestAPIVersion,
		Kind:       "Session",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-session-" + uuid.New().String()[:8],
			Org:  TestOrg,
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
	for _, opt := range resOpts {
		opt(session)
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

// ExecutionResourceOption applies to the full AgentExecution resource.
type ExecutionResourceOption func(*agentexecv1.AgentExecution)

// WithExecutionOrg overrides the org on the execution metadata (defaults to TestOrg).
func WithExecutionOrg(org string) ExecutionResourceOption {
	return func(e *agentexecv1.AgentExecution) {
		e.Metadata.Org = org
	}
}

// CreateTestAgentExecution creates an agent execution in the specified session.
// The execution is not cleaned up automatically — it is owned by the session.
func CreateTestAgentExecution(t *testing.T, ctx context.Context, clients *Clients, sessionID, message string, opts ...AgentExecutionOption) *agentexecv1.AgentExecution {
	t.Helper()
	return createTestAgentExecutionInternal(t, ctx, clients, sessionID, message, opts, nil)
}

// CreateTestAgentExecutionWithOrg creates an execution under a specific org.
func CreateTestAgentExecutionWithOrg(t *testing.T, ctx context.Context, clients *Clients, sessionID, message string, resOpts []ExecutionResourceOption, opts ...AgentExecutionOption) *agentexecv1.AgentExecution {
	t.Helper()
	return createTestAgentExecutionInternal(t, ctx, clients, sessionID, message, opts, resOpts)
}

func createTestAgentExecutionInternal(t *testing.T, ctx context.Context, clients *Clients, sessionID, message string, opts []AgentExecutionOption, resOpts []ExecutionResourceOption) *agentexecv1.AgentExecution {
	t.Helper()

	spec := &agentexecv1.AgentExecutionSpec{
		SessionId: sessionID,
		Message:   message,
	}
	for _, opt := range opts {
		opt(spec)
	}

	exec := &agentexecv1.AgentExecution{
		ApiVersion: TestAPIVersion,
		Kind:       "AgentExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-exec-" + uuid.New().String()[:8],
			Org:  TestOrg,
		},
		Spec: spec,
	}
	for _, opt := range resOpts {
		opt(exec)
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

// WithSupersedesExecutionId marks the execution as the edit-and-resubmit
// replacement of an earlier turn.
func WithSupersedesExecutionId(executionID string) AgentExecutionOption {
	return func(s *agentexecv1.AgentExecutionSpec) {
		s.SupersedesExecutionId = executionID
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

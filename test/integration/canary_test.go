//go:build integration

package integration

import (
	"context"
	"os"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// ---------------------------------------------------------------------------
// Canary tests: minimal live provider health checks.
//
// Each test verifies a single code path reaches COMPLETED. No content
// assertions — only phase. These are designed for nightly CI runs to
// detect provider regressions (model retirement, proxy breakage, etc.).
//
// Run via: make test-integration-canary
// ---------------------------------------------------------------------------

func requireCanaryAnthropicPrereqs(t *testing.T) {
	t.Helper()
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		t.Skip("ANTHROPIC_API_KEY not set — skipping canary test")
	}
}

func requireCanaryCursorPrereqs(t *testing.T) {
	t.Helper()
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if os.Getenv("CURSOR_API_KEY") == "" {
		t.Skip("CURSOR_API_KEY not set — skipping cursor canary test")
	}
}

func TestCanary_NativeAgentCompletes(t *testing.T) {
	requireCanaryAnthropicPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := harness.CreateAgent(t, ctx, clients, "canary-native",
		"You are a helpful assistant. Respond briefly.")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Reply with exactly: canary-ok")

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
	require.NoError(t, err, "canary native agent execution should reach COMPLETED")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("canary native agent OK: id=%s", result.GetMetadata().GetId())
}

func TestCanary_CursorAgentCompletes(t *testing.T) {
	requireCanaryCursorPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := harness.CreateAgent(t, ctx, clients, "canary-cursor",
		"You are a helpful assistant. Respond briefly.")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Reply with exactly: canary-ok")

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
	require.NoError(t, err, "canary cursor agent execution should reach COMPLETED")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("canary cursor agent OK: id=%s", result.GetMetadata().GetId())
}

func TestCanary_LlmCallProxy(t *testing.T) {
	requireCanaryAnthropicPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "canary-llm", suiteLogger)
	defer deployer.Cleanup(ctx)

	taskConfig, err := structpb.NewStruct(map[string]any{
		"model":       "claude-sonnet-4.6",
		"prompt":      "Reply with exactly one word: OK",
		"max_tokens":  float64(10),
		"timeout":     float64(60),
		"max_retries": float64(1),
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "canary-llm-call",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Canary: llm_call proxy health check",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "canary-llm-call",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "healthCheck",
					Kind:       workflowv1.WorkflowTaskKind_llm_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "canary llm health")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "canary llm_call should reach COMPLETED")
	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("canary llm_call OK: id=%s", result.GetMetadata().GetId())
}

func TestCanary_McpToolStdio(t *testing.T) {
	requireCanaryAnthropicPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	if mcpTestServerBinary == "" {
		t.Skip("mcp test server binary not built — skipping MCP stdio canary")
	}

	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

	agent := harness.CreateAgent(t, ctx, clients, "canary-mcp-stdio",
		"You are a test agent. Use the echo tool to echo 'canary-check'.",
		harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug(), "echo"),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Use the echo tool to echo 'canary-check'",
		harness.WithAutoApproveAll(true))

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
	require.NoError(t, err, "canary MCP stdio should reach COMPLETED")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("canary MCP stdio OK: id=%s", result.GetMetadata().GetId())
}

func TestCanary_McpToolHttp(t *testing.T) {
	requireCanaryAnthropicPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	if mcpTestServerBinary == "" {
		t.Skip("mcp test server binary not built — skipping MCP HTTP canary")
	}

	// Start a local HTTP MCP test server for the canary check.
	// Reuse the stdio binary through CreateStdioMcpServer since HTTP MCP
	// servers require external endpoints. If an HTTP endpoint is available
	// via env, use that; otherwise skip.
	httpEndpoint := os.Getenv("MCP_HTTP_TEST_ENDPOINT")
	if httpEndpoint == "" {
		t.Skip("MCP_HTTP_TEST_ENDPOINT not set — skipping MCP HTTP canary")
	}

	mcpServer := harness.CreateHttpMcpServer(t, ctx, clients, httpEndpoint)
	harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

	agent := harness.CreateAgent(t, ctx, clients, "canary-mcp-http",
		"You are a test agent. Use the available tools.",
		harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug()),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"List the available tools",
		harness.WithAutoApproveAll(true))

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
	require.NoError(t, err, "canary MCP HTTP should reach COMPLETED")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("canary MCP HTTP OK: id=%s", result.GetMetadata().GetId())
}

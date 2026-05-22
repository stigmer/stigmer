//go:build integration

package offline

import (
	"context"
	"strings"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// startOfflineRunner creates a MockLLMProxyServer from the given entries,
// starts a UnifiedRunnerManager pointed at it, and returns both. The runner
// manager uses IPC mode so AddSession() routes activities to per-session
// workers that hit the mock instead of a real LLM provider.
func startOfflineRunner(
	t *testing.T,
	ctx context.Context,
	entries []harness.RecordedLLMEntry,
) (*harness.MockLLMProxyServer, *harness.UnifiedRunnerManager) {
	t.Helper()

	mockLLM := harness.NewMockLLMProxyServerFromEntries(entries)
	t.Cleanup(func() { mockLLM.Close() })

	mgr, err := harness.StartUnifiedRunnerManager(ctx, harness.UnifiedRunnerConfig{
		StigmerServiceAddress: testHarness.Service.GRPCAddress(),
		TemporalAddress:       testHarness.Temporal.Address(),
		LogDir:                testHarness.LogDir(),
		ProxyEndpoint:         mockLLM.URL(),
	}, suiteLogger)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			t.Skipf("unified runner not available: %v", err)
		}
		t.Fatalf("failed to start offline runner manager: %v", err)
	}
	t.Cleanup(func() {
		if err := mgr.Stop(); err != nil {
			t.Logf("warning: failed to stop runner manager: %v", err)
		}
	})

	return mockLLM, mgr
}

// requireOfflinePrereqs checks that the shared harness and MCP server are
// available. Tests call this before any resource creation.
func requireOfflinePrereqs(t *testing.T) {
	t.Helper()
	require.NotNil(t, testHarness.Service, "java service must be running")
	require.NotNil(t, grpcConn, "gRPC connection required")
	if mcpTestServerBinary == "" {
		t.Skip("mcp test server binary not built — skipping offline test")
	}
}

// --- Offline Agent Execution Tests ---
// These tests use recorded LLM responses for deterministic execution.
// They exercise the full pipeline (runner → LLM mock → tool dispatch →
// StatusBuilder → proto) without provider non-determinism.

func TestOffline_MCP_EchoToolExecution(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	// Turn 1: LLM calls echo tool
	// Turn 2: LLM responds with summary after getting tool result
	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicToolUseResponse(
			"toolu_echo_01", "echo", map[string]any{"text": "hello-offline-test"},
			300, 40,
		)),
		harness.BuildLLMEntry(1, harness.AnthropicTextResponse(
			"The echo tool returned: hello-offline-test", 500, 25,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

	agent := harness.CreateAgent(t, ctx, clients,
		"offline-echo-"+t.Name(),
		"You are a test agent. Use the tools provided.",
		harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug(), "echo", "fail"),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err, "AddSession should succeed")

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Use the echo tool to echo 'hello-offline-test'",
		harness.WithAutoApproveAll(true),
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "offline execution should complete")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	harness.AssertHasToolCall(t, result, "echo")

	assert.Equal(t, 0, mockLLM.Remaining(), "all mock LLM entries should be consumed")

	t.Logf("offline MCP echo test passed: messages=%d, tool_calls=%d, mock_consumed=%d",
		len(result.GetStatus().GetMessages()),
		countToolCalls(result),
		mockLLM.Consumed(),
	)
}

func TestOffline_MCP_ToolFailure(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicToolUseResponse(
			"toolu_fail_01", "fail", map[string]any{"message": "test-error"},
			280, 30,
		)),
		harness.BuildLLMEntry(1, harness.AnthropicTextResponse(
			"The fail tool encountered an error: test-error",
			420, 25,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

	agent := harness.CreateAgent(t, ctx, clients,
		"offline-fail-"+t.Name(),
		"You are a test agent. Use the tools provided.",
		harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug(), "echo", "fail"),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err, "AddSession should succeed")

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Use the fail tool with message 'test-error'",
		harness.WithAutoApproveAll(true),
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "offline execution should complete even with tool failure")

	harness.AssertHasToolCall(t, result, "fail")
	assert.Equal(t, 0, mockLLM.Remaining())

	t.Logf("offline MCP fail test passed: mock_consumed=%d", mockLLM.Consumed())
}

func TestOffline_ToolCall_ProtoFieldContract(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicToolUseResponse(
			"toolu_contract_01", "echo", map[string]any{"text": "structural-test"},
			300, 35,
		)),
		harness.BuildLLMEntry(1, harness.AnthropicTextResponse(
			"The echo tool returned: structural-test", 450, 20,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

	agent := harness.CreateAgent(t, ctx, clients,
		"offline-contract-"+t.Name(),
		"You are a test agent. Use the tools provided.",
		harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug(), "echo"),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err, "AddSession should succeed")

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Use the echo tool to echo 'structural-test'",
		harness.WithAutoApproveAll(true),
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err)

	var echoCall *agentexecv1.ToolCall
	for _, msg := range result.GetStatus().GetMessages() {
		for _, tc := range msg.GetToolCalls() {
			if tc.GetName() == "echo" {
				echoCall = tc
				break
			}
		}
		if echoCall != nil {
			break
		}
	}

	require.NotNil(t, echoCall, "echo tool call must be present")
	assert.NotEmpty(t, echoCall.GetId(), "tool call ID must be set")
	assert.Equal(t, "echo", echoCall.GetName())
	assert.NotEmpty(t, echoCall.GetStartedAt(), "startedAt must be set")
	assert.NotEmpty(t, echoCall.GetCompletedAt(), "completedAt must be set")
	assert.NotEmpty(t, echoCall.GetResult(), "result must be set")
	assert.NotEmpty(t, echoCall.GetMcpServerSlug(), "mcpServerSlug must be set for MCP tools")

	assert.Equal(t, 0, mockLLM.Remaining())

	t.Logf("offline proto contract test passed: tool_id=%s, mcp_slug=%s",
		echoCall.GetId(), echoCall.GetMcpServerSlug())
}

func countToolCalls(exec *agentexecv1.AgentExecution) int {
	count := 0
	for _, msg := range exec.GetStatus().GetMessages() {
		count += len(msg.GetToolCalls())
	}
	return count
}

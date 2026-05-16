//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
)

func requireMCPPrereqs(t *testing.T, h harness.HarnessConfig) {
	t.Helper()
	h.Skip(t, testHarness)
	if mcpTestServerBinary == "" {
		t.Skip("test MCP server binary not built — skipping MCP test")
	}
}

func TestAgentExecution_MCP_StdioToolExecution(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			requireMCPPrereqs(t, h)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-mcp-stdio-"+h.Name,
				"You are a helpful assistant with access to tools. When asked to echo something, use the echo tool. When asked to add numbers, use the add tool.",
				harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug()),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Please use the echo tool to echo 'hello-mcp-test'",
				harness.WithAutoApproveAll(true))

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should complete")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			harness.AssertHasToolCall(t, result, "echo")
			harness.AssertToolCallMcpSlug(t, result, "echo", mcpServer.GetMetadata().GetSlug())

			t.Logf("MCP stdio test completed: id=%s, messages=%d",
				result.GetMetadata().GetId(),
				len(result.GetStatus().GetMessages()))
		})
	}
}

func TestAgentExecution_MCP_ToolFailure(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			requireMCPPrereqs(t, h)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-mcp-fail-"+h.Name,
				"You are a helpful assistant. When asked to test error handling, use the fail tool with the message 'test-error'. If the tool fails, acknowledge the failure and respond.",
				harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug()),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Please use the fail tool with message 'test-error'. Then tell me what happened.",
				harness.WithAutoApproveAll(true))

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should complete despite tool failure")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			// The agent should have attempted the fail tool
			harness.AssertHasToolCall(t, result, "fail")
		})
	}
}

func TestAgentExecution_MCP_EnabledToolsFilter(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			requireMCPPrereqs(t, h)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

			// Only enable the "echo" tool — add, fail, slow should not be available
			agent := harness.CreateAgent(t, ctx, clients, "test-mcp-filter-"+h.Name,
				"You are a helpful assistant. Use the echo tool to echo 'filter-test'. Do NOT use the add tool.",
				harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug(), "echo"),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Please use the echo tool to echo 'filter-test'.",
				harness.WithAutoApproveAll(true))

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should complete")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			harness.AssertHasToolCall(t, result, "echo")
		})
	}
}

func TestAgentExecution_MCP_ConnectionFailure(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			// Point to a nonexistent binary — the MCP server cannot start
			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, "/nonexistent/mcp-server-binary")

			agent := harness.CreateAgent(t, ctx, clients, "test-mcp-connfail-"+h.Name,
				"You are a helpful assistant. Use the echo tool to echo 'test'.",
				harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug()),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Use the echo tool to echo 'test'.",
				harness.WithAutoApproveAll(true))

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 3*time.Minute)
			require.NoError(t, err, "execution should reach a terminal phase")

			phase := result.GetStatus().GetPhase()
			t.Logf("MCP connection failure test: phase=%s, id=%s", phase.String(), exec.GetMetadata().GetId())

			// The execution should handle the failure gracefully: either FAILED
			// (MCP connection error) or COMPLETED (agent responded without the tool)
			require.True(t,
				phase == agentexecv1.ExecutionPhase_EXECUTION_FAILED ||
					phase == agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
				"expected FAILED or COMPLETED, got %s", phase.String())
		})
	}
}

func TestAgentExecution_MCP_HttpToolExecution(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			httpServer := harness.StartHTTPMcpServer(t)

			mcpServer := harness.CreateHttpMcpServer(t, ctx, clients, httpServer.URL)

			agent := harness.CreateAgent(t, ctx, clients, "test-mcp-http-"+h.Name,
				"You are a helpful assistant with access to tools. When asked to echo something, use the echo tool.",
				harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug()),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Please use the echo tool to echo 'hello-http-mcp'",
				harness.WithAutoApproveAll(true))

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should complete")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			harness.AssertHasToolCall(t, result, "echo")
			harness.AssertToolCallMcpSlug(t, result, "echo", mcpServer.GetMetadata().GetSlug())

			t.Logf("HTTP MCP test completed: id=%s, messages=%d",
				result.GetMetadata().GetId(),
				len(result.GetStatus().GetMessages()))
		})
	}
}

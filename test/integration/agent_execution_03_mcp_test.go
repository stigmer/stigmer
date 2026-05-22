//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	executionctxv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
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

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
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

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
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

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
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

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
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

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			httpServer := harness.StartHTTPMcpServer(t)

			mcpServer := harness.CreateHttpMcpServer(t, ctx, clients, httpServer.URL)

			// Discover tools via the agent-runner connect workflow. The in-process
			// httptest server is reachable from the local Python worker.
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())
			mcpServer = harness.WaitForMcpServerTool(t, ctx, clients,
				mcpServer.GetMetadata().GetId(), "echo", 2*time.Minute)

			agent := harness.CreateAgent(t, ctx, clients, "test-mcp-http-"+h.Name,
				"Call the echo tool exactly once with the user's input, then stop. Do not use any other tool. Do not call echo more than once.",
				harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug()),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			// Retry once on LLM non-determinism: if the LLM responds with
			// text instead of calling the tool, create a fresh execution.
			var result *agentexecv1.AgentExecution
			const maxAttempts = 2
			for attempt := 1; attempt <= maxAttempts; attempt++ {
				exec := harness.CreateTestAgentExecution(t, ctx, clients,
					session.GetMetadata().GetId(),
					"Please use the echo tool to echo 'hello-http-mcp'",
					harness.WithAutoApproveAll(true))

				var err error
				result, err = waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
					agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
				if err != nil {
					harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
				}
				require.NoError(t, err, "execution should complete")

				if harness.HasToolCall(result, "echo") {
					break
				}
				if attempt < maxAttempts {
					t.Logf("HTTP MCP retry: LLM skipped echo tool on attempt %d, retrying", attempt)
					harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
					continue
				}
			}
			require.NotNil(t, result)
			harness.AssertHasToolCall(t, result, "echo")
			harness.AssertToolCallMcpSlug(t, result, "echo", mcpServer.GetMetadata().GetSlug())

			t.Logf("HTTP MCP test completed: id=%s, messages=%d",
				result.GetMetadata().GetId(),
				len(result.GetStatus().GetMessages()))
		})
	}
}

func TestAgentExecution_MCP_EnvVarResolution(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)
			if mcpTestServerBinary == "" {
				t.Skip("test MCP server binary not built — skipping env var resolution test")
			}

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			// Create an MCP server with a ${TEST_SECRET} placeholder in args.
			// The args are passed to the binary; the test MCP server ignores
			// extra args, so successful tool execution proves the placeholder
			// was resolved (unresolved placeholders cause a startup error).
			name := "test-mcp-envvar-" + uuid.New().String()[:8]
			server := &mcpserverv1.McpServer{
				ApiVersion: "agentic.stigmer.ai/v1",
				Kind:       "McpServer",
				Metadata: &apiresource.ApiResourceMetadata{
					Name: name,
					Org:  "test-org",
				},
				Spec: &mcpserverv1.McpServerSpec{
					Description: "MCP server with env var placeholder in args",
					ServerType: &mcpserverv1.McpServerSpec_Stdio{
						Stdio: &mcpserverv1.StdioServerConfig{
							Command: mcpTestServerBinary,
							Args:    []string{"--secret=${TEST_SECRET}"},
						},
					},
					Env: map[string]*environmentv1.EnvVarDeclaration{
						"TEST_SECRET": {
							Description: "Test secret for env var resolution",
							IsSecret:    true,
						},
					},
				},
			}

			mcpServer, err := clients.McpServerCommand.Apply(ctx, server)
			require.NoError(t, err, "apply MCP server with env placeholder should succeed")
			t.Cleanup(func() {
				cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				clients.McpServerCommand.Delete(cleanCtx, &apiresource.ApiResourceDeleteInput{ResourceId: mcpServer.GetMetadata().GetId()})
			})

			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId(),
				harness.WithConnectRuntimeEnv(map[string]*executionctxv1.ExecutionValue{
					"TEST_SECRET": {Value: "resolved-secret-value", IsSecret: true},
				}),
			)

			agent := harness.CreateAgent(t, ctx, clients, "test-envvar-"+h.Name,
				"You are a helpful assistant with access to tools. Use the echo tool to echo 'env-resolved'.",
				harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug()),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			// Provide the env var value via runtime_env on the execution.
			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Use the echo tool to echo 'env-resolved'.",
				harness.WithAutoApproveAll(true),
				harness.WithRuntimeEnv(map[string]*executionctxv1.ExecutionValue{
					"TEST_SECRET": {Value: "resolved-secret-value", IsSecret: true},
				}),
			)

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should complete — env var was resolved and MCP server started")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			harness.AssertHasToolCall(t, result, "echo")
			t.Logf("env var resolution test completed: id=%s, messages=%d",
				result.GetMetadata().GetId(), len(result.GetStatus().GetMessages()))
		})
	}
}

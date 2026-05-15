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

func TestAgentExecution_Config_MaxToolRounds(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)
			if mcpTestServerBinary == "" {
				t.Skip("test MCP server binary not built")
			}

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

			agent := harness.CreateAgent(t, ctx, clients, "test-config-rounds-"+h.Name,
				"You are a helpful assistant. When asked, repeatedly use the echo tool in a loop. Keep calling echo with different values.",
				harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug()),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			// Set a very low max_tool_rounds so the execution terminates quickly
			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Please call the echo tool repeatedly with numbers 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 one at a time.",
				harness.WithAutoApproveAll(true),
				harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
					MaxToolRounds: 10,
				}),
			)

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 4*time.Minute)
			require.NoError(t, err, "execution should reach a terminal phase")

			// With limited tool rounds, the execution should terminate or complete
			phase := result.GetStatus().GetPhase()
			require.True(t,
				phase == agentexecv1.ExecutionPhase_EXECUTION_COMPLETED ||
					phase == agentexecv1.ExecutionPhase_EXECUTION_TERMINATED,
				"expected COMPLETED or TERMINATED, got %s", phase.String())

			t.Logf("max_tool_rounds test completed: id=%s, phase=%s",
				result.GetMetadata().GetId(), phase.String())
		})
	}
}

func TestAgentExecution_Config_ModelOverride(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			agent := harness.CreateAgent(t, ctx, clients, "test-config-model-"+h.Name,
				"You are a helpful assistant. Respond briefly.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			// Each harness resolves model names differently.
			// Native runner uses the Anthropic SDK directly; Cursor has its own registry.
			modelName := "claude-sonnet-4-20250514"
			if h.Name == "cursor" {
				modelName = "claude-haiku-4-20250514"
			}

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Reply with exactly: hello",
				harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
					ModelName: modelName,
				}),
			)

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should complete with overridden model")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			t.Logf("model override test completed: id=%s, model=%s", result.GetMetadata().GetId(), modelName)
		})
	}
}

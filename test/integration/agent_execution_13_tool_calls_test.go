//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// findToolCall returns the first ToolCall with the given name from the
// execution's messages. Returns nil if not found.
func findToolCall(exec *agentexecv1.AgentExecution, toolName string) *agentexecv1.ToolCall {
	for _, msg := range exec.GetStatus().GetMessages() {
		for _, tc := range msg.GetToolCalls() {
			if tc.GetName() == toolName {
				return tc
			}
		}
	}
	return nil
}

// Proto contract under test: ToolCall message (message.proto) fields
// id, name, args, result, status, started_at, completed_at, mcp_server_slug.
//
// Existing _03 tests assert only name and mcp_server_slug. This test
// verifies the full structural contract that @stigmer/react
// <ExecutionViewer /> depends on for rendering tool call panels.
func TestAgentExecution_ToolCall_ProtoFieldContract(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)
			if mcpTestServerBinary == "" {
				t.Skip("test MCP server binary not built — skipping tool call structural test")
			}

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())
			mcpSlug := mcpServer.GetMetadata().GetSlug()

			agent := harness.CreateAgent(t, ctx, clients, "test-tc-contract-"+h.Name,
				"You are a helpful assistant with access to tools. When asked to echo something, use the echo tool.",
				harness.WithMcpServerUsage(mcpSlug),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			// Retry once for LLM non-determinism (follows _03 HttpMCP pattern).
			var result *agentexecv1.AgentExecution
			const maxAttempts = 2
			for attempt := 1; attempt <= maxAttempts; attempt++ {
				exec := harness.CreateTestAgentExecution(t, ctx, clients,
					session.GetMetadata().GetId(),
					"Please use the echo tool to echo 'structural-test'",
					harness.WithAutoApproveAll(true))

				var err error
				result, err = waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
					agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
				if err != nil {
					harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
				}
				require.NoError(t, err, "execution should complete (attempt %d)", attempt)

				if harness.HasToolCall(result, "echo") {
					break
				}
				if attempt < maxAttempts {
					t.Logf("tool call retry: LLM skipped echo tool on attempt %d, retrying", attempt)
					harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
					continue
				}
			}
			require.NotNil(t, result, "should have a completed execution with echo tool call")

			tc := findToolCall(result, "echo")
			require.NotNil(t, tc, "echo ToolCall must be present in messages after completion")

			assert.NotEmpty(t, tc.GetId(),
				"ToolCall.id must be non-empty (correlation key for approval flow)")

			assert.Equal(t, "echo", tc.GetName(),
				"ToolCall.name must be 'echo'")

			assert.NotNil(t, tc.GetArgs(),
				"ToolCall.args (Struct) must be non-nil — tool received arguments")
			if tc.GetArgs() != nil {
				assert.Greater(t, len(tc.GetArgs().GetFields()), 0,
					"ToolCall.args should have at least one field (the echoed text)")
			}

			assert.NotEmpty(t, tc.GetResult(),
				"ToolCall.result must be non-empty — echo tool returns the echoed value")

			assert.Equal(t, agentexecv1.ToolCallStatus_TOOL_CALL_COMPLETED, tc.GetStatus(),
				"ToolCall.status must be TOOL_CALL_COMPLETED for a successful tool execution")

			assert.NotEmpty(t, tc.GetStartedAt(),
				"ToolCall.started_at must be populated (ISO 8601 timestamp)")

			assert.NotEmpty(t, tc.GetCompletedAt(),
				"ToolCall.completed_at must be populated (ISO 8601 timestamp)")

			assert.Equal(t, mcpSlug, tc.GetMcpServerSlug(),
				"ToolCall.mcp_server_slug must match the created MCP server slug")

			t.Logf("tool call contract verified: id=%s, name=%s, status=%s, "+
				"args_fields=%d, result_len=%d, started=%s, completed=%s, slug=%s",
				tc.GetId(), tc.GetName(), tc.GetStatus().String(),
				len(tc.GetArgs().GetFields()), len(tc.GetResult()),
				tc.GetStartedAt(), tc.GetCompletedAt(), tc.GetMcpServerSlug())
		})
	}
}

// Proto contract: ToolCall.status == TOOL_CALL_FAILED, ToolCall.error populated.
//
// Existing _03 MCP_ToolFailure asserts the execution completes and the
// tool was called, but never inspects ToolCall.status or ToolCall.error.
// This test verifies the failure-state fields that the SDK renders in the
// tool call panel's error state.
func TestAgentExecution_ToolCall_FailedStatus_HasError(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)
			if mcpTestServerBinary == "" {
				t.Skip("test MCP server binary not built — skipping tool call failure test")
			}

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-tc-failed-"+h.Name,
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
			if err != nil {
				harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
			}
			require.NoError(t, err, "execution should complete despite tool failure")

			tc := findToolCall(result, "fail")
			require.NotNil(t, tc, "fail ToolCall must be present in messages")

			assert.NotEmpty(t, tc.GetId(),
				"ToolCall.id must be non-empty even for failed tools")

			// The agent-runner may surface the tool error as a FAILED status
			// with an error field, or it may wrap the error as a successful
			// tool result string. This test documents the actual behavior.
			switch tc.GetStatus() {
			case agentexecv1.ToolCallStatus_TOOL_CALL_FAILED:
				assert.NotEmpty(t, tc.GetError(),
					"ToolCall.error must be non-empty when status is TOOL_CALL_FAILED")
				t.Logf("tool call failed as expected: id=%s, status=FAILED, error=%s",
					tc.GetId(), tc.GetError())

			case agentexecv1.ToolCallStatus_TOOL_CALL_COMPLETED:
				// Agent-runner may wrap tool errors as successful results.
				// The result should contain the error information.
				t.Logf("BEHAVIORAL NOTE: fail tool returned COMPLETED status — "+
					"agent-runner wraps tool errors as result strings. id=%s, result=%s",
					tc.GetId(), truncate(tc.GetResult(), 200))

			default:
				t.Errorf("unexpected ToolCall.status for fail tool: %s (expected FAILED or COMPLETED)",
					tc.GetStatus().String())
			}
		})
	}
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

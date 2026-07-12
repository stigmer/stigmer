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

// collectNonTerminalToolCalls walks the whole transcript — top-level messages
// and every sub-agent's — and returns each tool call still in a non-terminal
// status (PENDING / RUNNING / WAITING_APPROVAL).
func collectNonTerminalToolCalls(exec *agentexecv1.AgentExecution) []*agentexecv1.ToolCall {
	var stuck []*agentexecv1.ToolCall
	scan := func(messages []*agentexecv1.AgentMessage) {
		for _, msg := range messages {
			for _, tc := range msg.GetToolCalls() {
				switch tc.GetStatus() {
				case agentexecv1.ToolCallStatus_TOOL_CALL_PENDING,
					agentexecv1.ToolCallStatus_TOOL_CALL_RUNNING,
					agentexecv1.ToolCallStatus_TOOL_CALL_WAITING_APPROVAL:
					stuck = append(stuck, tc)
				}
			}
		}
	}
	scan(exec.GetStatus().GetMessages())
	for _, sa := range exec.GetStatus().GetSubAgentExecutions() {
		scan(sa.GetMessages())
	}
	return stuck
}

// Issue #207 acceptance, end to end: a terminal execution carries ZERO
// non-terminal tool calls. Terminating an execution while its tool is
// mid-flight (the 30s slow MCP tool guarantees the window) must settle the
// in-flight call to TOOL_CALL_INTERRUPTED — never leave it a permanent
// RUNNING/PENDING zombie.
func TestAgentExecution_Terminate_SettlesInFlightToolCallsToInterrupted(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)
			if mcpTestServerBinary == "" {
				t.Skip("test MCP server binary not built — skipping interrupted tool call test")
			}

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-tc-interrupted-"+h.Name,
				"You MUST call the slow tool with seconds=30. Do not respond with text. Your only action is calling the slow tool.",
				harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug()),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Call the slow tool with seconds=30.",
				harness.WithAutoApproveAll(true))
			execID := exec.GetMetadata().GetId()

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			_, err := waiter.WaitForPhase(ctx, execID,
				agentexecv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 2*time.Minute)
			require.NoError(t, err, "execution should reach IN_PROGRESS")

			// Terminate only once the slow call is genuinely in flight — the tool
			// sleeps 30s, so seeing it persisted guarantees a mid-flight window.
			require.NoError(t, waitForToolCallPresence(ctx, clients, execID, "slow", 90*time.Second),
				"the slow tool call should appear in the persisted transcript")

			_, err = clients.AgentExecutionCommand.Terminate(ctx, &agentexecv1.TerminateAgentExecutionInput{
				Id: execID,
			})
			require.NoError(t, err, "terminate should succeed")

			result, err := waiter.WaitForPhase(ctx, execID,
				agentexecv1.ExecutionPhase_EXECUTION_TERMINATED, 2*time.Minute)
			require.NoError(t, err, "execution should reach TERMINATED")

			// The invariant: zero non-terminal tool calls on a terminal execution.
			stuck := collectNonTerminalToolCalls(result)
			if !assert.Empty(t, stuck,
				"a terminal execution must carry zero non-terminal tool calls (issue #207)") {
				for _, tc := range stuck {
					t.Logf("zombie tool call: id=%s name=%s status=%s",
						tc.GetId(), tc.GetName(), tc.GetStatus().String())
				}
			}

			// The mid-flight slow call specifically settled to INTERRUPTED with a
			// completion timestamp — honest terminal state, not FAILED/SKIPPED.
			tc := findToolCall(result, "slow")
			require.NotNil(t, tc, "slow ToolCall must be present in messages")
			assert.Equal(t, agentexecv1.ToolCallStatus_TOOL_CALL_INTERRUPTED, tc.GetStatus(),
				"the in-flight slow call must settle to TOOL_CALL_INTERRUPTED")
			assert.NotEmpty(t, tc.GetCompletedAt(),
				"a settled call carries a completion timestamp")

			t.Logf("interrupted settle verified: id=%s status=%s completed_at=%s",
				tc.GetId(), tc.GetStatus().String(), tc.GetCompletedAt())
		})
	}
}

// waitForToolCallPresence polls the persisted execution until a tool call with
// the given name appears in its transcript.
func waitForToolCallPresence(
	ctx context.Context,
	clients *harness.Clients,
	executionID, toolName string,
	timeout time.Duration,
) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
		exec, err := clients.AgentExecutionQuery.Get(ctx, &agentexecv1.AgentExecutionId{Value: executionID})
		if err != nil {
			continue
		}
		if harness.HasToolCall(exec, toolName) {
			return nil
		}
	}
	return context.DeadlineExceeded
}

//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
)

// requireHITLPrereqs ensures the test MCP server binary is built and available.
// HITL tests require both a runner and the test MCP server with approval-requiring tools.
func requireHITLPrereqs(t *testing.T, h harness.HarnessConfig) {
	t.Helper()
	h.Skip(t, testHarness)
	if mcpTestServerBinary == "" {
		t.Skip("test MCP server binary not built — skipping HITL test")
	}
}

func TestAgentExecution_HITL_Approve(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			requireHITLPrereqs(t, h)
			harness.SkipCursorForHITLGate(t, h)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-hitl-approve-"+h.Name,
				"You MUST call the echo tool exactly once with the user's input, then stop. Never respond with text only. Do not call any tool again.",
				harness.WithMcpServerUsageAndApproval(
					mcpServer.GetMetadata().GetSlug(),
					[]*agentv1.ToolApprovalOverride{
						{ToolName: "echo", RequiresApproval: true, Message: "Execute echo tool"},
					},
					"echo",
				),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			exec, waiting := waiter.WaitForApprovalWithRetry(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Call the echo tool with input 'hello-hitl'. You must use the tool.",
				2*time.Minute,
				harness.WithAutoApproveAll(false))

			harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
			harness.AssertPendingApprovals(t, waiting, 1)

			approval := waiting.GetStatus().GetPendingApprovals()[0]
			t.Logf("pending approval: tool=%s, id=%s", approval.GetToolName(), approval.GetToolCallId())

			result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
				exec.GetMetadata().GetId(),
				agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
				3*time.Minute,
			)
			require.NoError(t, err, "execution should complete after approval")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
		})
	}
}

func TestAgentExecution_HITL_Skip(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			requireHITLPrereqs(t, h)
			harness.SkipCursorForHITLGate(t, h)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-hitl-skip-"+h.Name,
				"You MUST call the echo tool exactly once with the user's input, then stop. Never respond with text only. Do not call any tool again.",
				harness.WithMcpServerUsageAndApproval(
					mcpServer.GetMetadata().GetSlug(),
					[]*agentv1.ToolApprovalOverride{
						{ToolName: "echo", RequiresApproval: true},
					},
					"echo",
				),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			exec, _ := waiter.WaitForApprovalWithRetry(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Call the echo tool with input 'test-skip'. You must use the tool.",
				2*time.Minute,
				harness.WithAutoApproveAll(false))

			result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
				exec.GetMetadata().GetId(),
				agentexecv1.ApprovalAction_APPROVAL_ACTION_SKIP,
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
				3*time.Minute,
			)
			require.NoError(t, err, "execution should complete after skip")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
		})
	}
}

func TestAgentExecution_HITL_Reject(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			requireHITLPrereqs(t, h)
			harness.SkipCursorForHITLGate(t, h)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-hitl-reject-"+h.Name,
				"You MUST call the echo tool exactly once with the user's input, then stop. Never respond with text only. Do not call any tool again.",
				harness.WithMcpServerUsageAndApproval(
					mcpServer.GetMetadata().GetSlug(),
					[]*agentv1.ToolApprovalOverride{
						{ToolName: "echo", RequiresApproval: true},
					},
					"echo",
				),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			exec, _ := waiter.WaitForApprovalWithRetry(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Call the echo tool with input 'test-reject'. You must use the tool.",
				2*time.Minute,
				harness.WithAutoApproveAll(false))

			result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
				exec.GetMetadata().GetId(),
				agentexecv1.ApprovalAction_APPROVAL_ACTION_REJECT,
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
				3*time.Minute,
			)
			require.NoError(t, err, "execution should complete after reject (tool skipped, agent continues)")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
		})
	}
}

func TestAgentExecution_HITL_AutoApproveAll(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			requireHITLPrereqs(t, h)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-hitl-auto-"+h.Name,
				"You MUST call the echo tool. Never respond with text only. Your ONLY action must be calling the echo tool with the user's message as input.",
				harness.WithMcpServerUsageAndApproval(
					mcpServer.GetMetadata().GetSlug(),
					[]*agentv1.ToolApprovalOverride{
						{ToolName: "echo", RequiresApproval: true},
					},
					"echo",
				),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Echo 'auto-approved'",
				harness.WithAutoApproveAll(true))

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
			require.NoError(t, err, "execution should complete without waiting for approval")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
		})
	}
}

func TestAgentExecution_HITL_WrongPhase(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-hitl-wrongphase-"+h.Name,
				"You are a helpful assistant. Respond briefly.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Reply with exactly: hello")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err)
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			// Submitting approval on a completed execution should fail
			_, err = clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
				AgentExecutionId: exec.GetMetadata().GetId(),
				ToolCallId:       "nonexistent",
				Action:           agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
			})
			require.Error(t, err, "submitting approval on completed execution should fail")
			t.Logf("wrong-phase approval correctly rejected: %v", err)
		})
	}
}

func TestAgentExecution_HITL_PendingApprovalDetails(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			requireHITLPrereqs(t, h)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())
			mcpSlug := mcpServer.GetMetadata().GetSlug()

			agent := harness.CreateAgent(t, ctx, clients, "test-hitl-details-"+h.Name,
				"You MUST call the echo tool. Never respond with text only. Your ONLY action must be calling the echo tool with {\"input\": \"detail-test\"}.",
				harness.WithMcpServerUsageAndApproval(
					mcpSlug,
					[]*agentv1.ToolApprovalOverride{
						{ToolName: "echo", RequiresApproval: true, Message: "Confirm echo call"},
					},
					"echo",
				),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Echo 'detail-test'",
				harness.WithAutoApproveAll(false))

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			waiting, err := waiter.WaitForApproval(ctx, exec.GetMetadata().GetId(), 2*time.Minute)
			require.NoError(t, err, "execution should reach WAITING_FOR_APPROVAL")

			approvals := waiting.GetStatus().GetPendingApprovals()
			require.Len(t, approvals, 1, "should have exactly 1 pending approval")

			approval := approvals[0]
			require.NotEmpty(t, approval.GetToolCallId(), "tool_call_id should be populated")
			require.Equal(t, "echo", approval.GetToolName(), "tool_name should be 'echo'")
			require.Equal(t, mcpSlug, approval.GetMcpServerSlug(),
				"mcp_server_slug should match the MCP server used")

			t.Logf("approval details: tool_call_id=%s, tool_name=%s, mcp_slug=%s, args_preview=%s",
				approval.GetToolCallId(), approval.GetToolName(),
				approval.GetMcpServerSlug(), approval.GetArgsPreview())

			// Clean up: approve so the execution can terminate
			_, err = clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
				AgentExecutionId: exec.GetMetadata().GetId(),
				ToolCallId:       approval.GetToolCallId(),
				Action:           agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
			})
			require.NoError(t, err)

			_, err = waiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 2*time.Minute)
			require.NoError(t, err)
		})
	}
}

func TestAgentExecution_HITL_IdempotentApproval(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			requireHITLPrereqs(t, h)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
			harness.ConnectMcpServer(t, ctx, clients, mcpServer.GetMetadata().GetId())

			agent := harness.CreateAgent(t, ctx, clients, "test-hitl-idempotent-"+h.Name,
				"You MUST call the echo tool. Never respond with text only. Your ONLY action must be calling the echo tool with the user's message as input.",
				harness.WithMcpServerUsageAndApproval(
					mcpServer.GetMetadata().GetSlug(),
					[]*agentv1.ToolApprovalOverride{
						{ToolName: "echo", RequiresApproval: true},
					},
					"echo",
				),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Echo 'idempotent-test'",
				harness.WithAutoApproveAll(false))

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			waiting, err := waiter.WaitForApproval(ctx, exec.GetMetadata().GetId(), 2*time.Minute)
			require.NoError(t, err)

			approval := waiting.GetStatus().GetPendingApprovals()[0]

			// First approval
			_, err = clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
				AgentExecutionId: exec.GetMetadata().GetId(),
				ToolCallId:       approval.GetToolCallId(),
				Action:           agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
			})
			require.NoError(t, err, "first approval should succeed")

			// Second approval (same tool_call_id) should be a no-op, not an error
			_, err = clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
				AgentExecutionId: exec.GetMetadata().GetId(),
				ToolCallId:       approval.GetToolCallId(),
				Action:           agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
			})
			// Idempotent: either succeeds silently or returns a benign error
			if err != nil {
				t.Logf("second approval returned (expected no-op or benign error): %v", err)
			}

			result, err := waiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 2*time.Minute)
			require.NoError(t, err, "execution should reach terminal")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
		})
	}
}

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

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

			agent := harness.CreateAgent(t, ctx, clients, "test-hitl-approve-"+h.Name,
				"You are a helpful assistant. When asked to echo something, use the echo tool to echo it back.",
				harness.WithMcpServerUsageAndApproval(
					mcpServer.GetMetadata().GetSlug(),
					[]*agentv1.ToolApprovalOverride{
						{ToolName: "echo", RequiresApproval: true, Message: "Execute echo tool"},
					},
				),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Please use the echo tool to echo 'hello-hitl'")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			// Wait for approval gate
			waiting, err := waiter.WaitForApproval(ctx, exec.GetMetadata().GetId(), 3*time.Minute)
			require.NoError(t, err, "execution should reach WAITING_FOR_APPROVAL")
			harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
			harness.AssertPendingApprovals(t, waiting, 1)

			approval := waiting.GetStatus().GetPendingApprovals()[0]
			t.Logf("pending approval: tool=%s, id=%s", approval.GetToolName(), approval.GetToolCallId())

			// Submit approval
			_, err = clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
				AgentExecutionId: exec.GetMetadata().GetId(),
				ToolCallId:       approval.GetToolCallId(),
				Action:           agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
			})
			require.NoError(t, err, "submit approval should succeed")

			// Wait for completion
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
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

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

			agent := harness.CreateAgent(t, ctx, clients, "test-hitl-skip-"+h.Name,
				"You are a helpful assistant. When asked to echo something, use the echo tool.",
				harness.WithMcpServerUsageAndApproval(
					mcpServer.GetMetadata().GetSlug(),
					[]*agentv1.ToolApprovalOverride{
						{ToolName: "echo", RequiresApproval: true},
					},
				),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Please use the echo tool to echo 'test-skip'")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			waiting, err := waiter.WaitForApproval(ctx, exec.GetMetadata().GetId(), 3*time.Minute)
			require.NoError(t, err)

			approval := waiting.GetStatus().GetPendingApprovals()[0]

			_, err = clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
				AgentExecutionId: exec.GetMetadata().GetId(),
				ToolCallId:       approval.GetToolCallId(),
				Action:           agentexecv1.ApprovalAction_APPROVAL_ACTION_SKIP,
			})
			require.NoError(t, err, "skip approval should succeed")

			// Execution should continue (not fail) after skip
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
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

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

			agent := harness.CreateAgent(t, ctx, clients, "test-hitl-reject-"+h.Name,
				"You are a helpful assistant. When asked to echo something, use the echo tool.",
				harness.WithMcpServerUsageAndApproval(
					mcpServer.GetMetadata().GetSlug(),
					[]*agentv1.ToolApprovalOverride{
						{ToolName: "echo", RequiresApproval: true},
					},
				),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Please use the echo tool to echo 'test-reject'")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			waiting, err := waiter.WaitForApproval(ctx, exec.GetMetadata().GetId(), 3*time.Minute)
			require.NoError(t, err)

			approval := waiting.GetStatus().GetPendingApprovals()[0]

			_, err = clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
				AgentExecutionId: exec.GetMetadata().GetId(),
				ToolCallId:       approval.GetToolCallId(),
				Action:           agentexecv1.ApprovalAction_APPROVAL_ACTION_REJECT,
			})
			require.NoError(t, err, "reject should succeed")

			result, err := waiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 3*time.Minute)
			require.NoError(t, err, "execution should reach terminal after reject")
			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_FAILED)
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

			mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

			agent := harness.CreateAgent(t, ctx, clients, "test-hitl-auto-"+h.Name,
				"You are a helpful assistant. When asked to echo something, use the echo tool.",
				harness.WithMcpServerUsageAndApproval(
					mcpServer.GetMetadata().GetSlug(),
					[]*agentv1.ToolApprovalOverride{
						{ToolName: "echo", RequiresApproval: true},
					},
				),
			)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			// auto_approve_all bypasses the approval gate entirely
			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Please use the echo tool to echo 'auto-approved'",
				harness.WithAutoApproveAll(true))

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
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

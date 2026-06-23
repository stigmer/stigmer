//go:build integration

package offline

import (
	"context"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// hitlToolCallEntries returns mock LLM entries for a simple HITL flow:
// Turn 1: LLM calls echo tool (triggers approval gate)
// Turn 2: LLM produces text summary after tool result
func hitlToolCallEntries() []harness.RecordedLLMEntry {
	return []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicToolUseResponse(
			"toolu_hitl_01", "echo", map[string]any{"input": "hello-hitl"},
			300, 35,
		)),
		harness.BuildLLMEntry(1, harness.AnthropicTextResponse(
			"The echo tool returned the result.", 500, 20,
		)),
	}
}

// hitlSkipRejectEntries returns mock LLM entries where the tool is
// skipped/rejected. After the tool is skipped, the LLM responds with text.
func hitlSkipRejectEntries() []harness.RecordedLLMEntry {
	return []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicToolUseResponse(
			"toolu_hitl_sr", "echo", map[string]any{"input": "test-skip-reject"},
			300, 35,
		)),
		harness.BuildLLMEntry(1, harness.AnthropicTextResponse(
			"The tool call was not executed. I'll proceed without it.",
			400, 25,
		)),
	}
}

func TestOffline_HITL_Approve(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	_, mgr := startOfflineRunner(t, ctx, hitlToolCallEntries())

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

	agent := harness.CreateAgent(t, ctx, clients, "offline-hitl-approve",
		"You MUST call the echo tool exactly once with the user's input, then stop.",
		harness.WithMcpServerUsageAndApproval(
			mcpServer.GetMetadata().GetSlug(),
			[]*agentv1.ToolApprovalOverride{
				{ToolName: "echo", RequiresApproval: true, Message: "Execute echo tool"},
			},
			"echo",
		),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Call the echo tool with input 'hello-hitl'. You must use the tool.",
		harness.WithAutoApproveAll(false))

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	waiting, err := waiter.WaitForApproval(ctx, exec.GetMetadata().GetId(), 2*time.Minute)
	require.NoError(t, err, "execution should reach WAITING_FOR_APPROVAL")

	harness.AssertAgentPhase(t, waiting, agentexecv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL)
	harness.AssertPendingApprovals(t, waiting, 1)

	approval := waiting.GetStatus().GetPendingApprovals()[0]
	assert.Equal(t, "echo", approval.GetToolName())
	t.Logf("pending approval: tool=%s, id=%s", approval.GetToolName(), approval.GetToolCallId())

	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		2*time.Minute,
	)
	require.NoError(t, err, "execution should complete after approval")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("offline HITL approve test passed")
}

func TestOffline_HITL_Skip(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	_, mgr := startOfflineRunner(t, ctx, hitlSkipRejectEntries())

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

	agent := harness.CreateAgent(t, ctx, clients, "offline-hitl-skip",
		"You MUST call the echo tool exactly once with the user's input, then stop.",
		harness.WithMcpServerUsageAndApproval(
			mcpServer.GetMetadata().GetSlug(),
			[]*agentv1.ToolApprovalOverride{
				{ToolName: "echo", RequiresApproval: true},
			},
			"echo",
		),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Call the echo tool with input 'test-skip'. You must use the tool.",
		harness.WithAutoApproveAll(false))

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	_, err = waiter.WaitForApproval(ctx, exec.GetMetadata().GetId(), 2*time.Minute)
	require.NoError(t, err)

	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_SKIP,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		2*time.Minute,
	)
	require.NoError(t, err, "execution should complete after skip")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("offline HITL skip test passed")
}

func TestOffline_HITL_Reject(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	_, mgr := startOfflineRunner(t, ctx, hitlSkipRejectEntries())

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

	agent := harness.CreateAgent(t, ctx, clients, "offline-hitl-reject",
		"You MUST call the echo tool exactly once with the user's input, then stop.",
		harness.WithMcpServerUsageAndApproval(
			mcpServer.GetMetadata().GetSlug(),
			[]*agentv1.ToolApprovalOverride{
				{ToolName: "echo", RequiresApproval: true},
			},
			"echo",
		),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Call the echo tool with input 'test-reject'. You must use the tool.",
		harness.WithAutoApproveAll(false))

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	_, err = waiter.WaitForApproval(ctx, exec.GetMetadata().GetId(), 2*time.Minute)
	require.NoError(t, err)

	result, err := waiter.ResolveApprovalsUntilPhase(ctx, clients,
		exec.GetMetadata().GetId(),
		agentexecv1.ApprovalAction_APPROVAL_ACTION_REJECT,
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		2*time.Minute,
	)
	require.NoError(t, err, "execution should complete after reject")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("offline HITL reject test passed")
}

func TestOffline_HITL_AutoApproveAll(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	_, mgr := startOfflineRunner(t, ctx, hitlToolCallEntries())

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)

	agent := harness.CreateAgent(t, ctx, clients, "offline-hitl-auto",
		"You MUST call the echo tool. Your ONLY action must be calling the echo tool.",
		harness.WithMcpServerUsageAndApproval(
			mcpServer.GetMetadata().GetSlug(),
			[]*agentv1.ToolApprovalOverride{
				{ToolName: "echo", RequiresApproval: true},
			},
			"echo",
		),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Echo 'auto-approved'",
		harness.WithAutoApproveAll(true))

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
	require.NoError(t, err, "execution should complete without waiting for approval")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("offline HITL auto-approve test passed")
}

func TestOffline_HITL_PendingApprovalDetails(t *testing.T) {
	requireOfflinePrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	_, mgr := startOfflineRunner(t, ctx, hitlToolCallEntries())

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	mcpServer := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
	mcpSlug := mcpServer.GetMetadata().GetSlug()

	agent := harness.CreateAgent(t, ctx, clients, "offline-hitl-details",
		"You MUST call the echo tool. Your ONLY action must be calling the echo tool.",
		harness.WithMcpServerUsageAndApproval(
			mcpSlug,
			[]*agentv1.ToolApprovalOverride{
				{ToolName: "echo", RequiresApproval: true, Message: "Confirm echo call"},
			},
			"echo",
		),
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		"Echo 'detail-test'",
		harness.WithAutoApproveAll(false))

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	waiting, err := waiter.WaitForApproval(ctx, exec.GetMetadata().GetId(), 2*time.Minute)
	require.NoError(t, err)

	approvals := waiting.GetStatus().GetPendingApprovals()
	require.Len(t, approvals, 1, "should have exactly 1 pending approval")

	approval := approvals[0]
	assert.NotEmpty(t, approval.GetToolCallId(), "tool_call_id should be populated")
	assert.Equal(t, "echo", approval.GetToolName())
	assert.Equal(t, mcpSlug, approval.GetMcpServerSlug(),
		"mcp_server_slug should match the MCP server used")
	// Negative half of the approval-gate diff (#186): a non-file tool projects no
	// file changes, so the gate render falls back to the args preview. The
	// projection only carries file_changes for file-modifying tools.
	assert.Empty(t, approval.GetFileChanges(),
		"a non-file tool (echo) must project an empty file_changes list")
	assert.NotEmpty(t, approval.GetArgsPreview(),
		"a gated tool without a diff must still carry an args preview to render")

	t.Logf("approval details: tool_call_id=%s, tool_name=%s, mcp_slug=%s, args_preview=%s",
		approval.GetToolCallId(), approval.GetToolName(),
		approval.GetMcpServerSlug(), approval.GetArgsPreview())

	// Approve to let execution complete
	_, err = clients.AgentExecutionCommand.SubmitApproval(ctx, &agentexecv1.SubmitApprovalInput{
		AgentExecutionId: exec.GetMetadata().GetId(),
		ToolCallId:       approval.GetToolCallId(),
		Action:           agentexecv1.ApprovalAction_APPROVAL_ACTION_APPROVE,
	})
	require.NoError(t, err)

	_, err = waiter.WaitForTerminal(ctx, exec.GetMetadata().GetId(), 2*time.Minute)
	require.NoError(t, err)

	t.Logf("offline HITL details test passed")
}

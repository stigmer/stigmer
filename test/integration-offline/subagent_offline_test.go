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

// --- Golden Baseline: Subagent Delegation ---
//
// Exercises the deepagents delegation path where the parent agent calls
// the built-in "task" tool with a subagent_type, the subagent runs its
// own LLM turn, and the parent synthesizes the result.
//
// Mock entries: 3 sequential turns
//   1. Parent → task tool_use (delegates to "researcher")
//   2. Subagent → text response
//   3. Parent → text response (synthesizes subagent output)
//
// This test validates:
//   - Execution completes successfully with subagent delegation
//   - Multiple messages from different namespaces appear in status
//   - Task tool call is recorded on the parent AI message
//   - All mock entries are consumed (no dropped/extra LLM calls)

func TestOffline_SubAgent_Delegation(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")
	require.NotNil(t, grpcConn, "gRPC connection required")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		// Turn 1: Parent delegates to researcher via "task" tool
		harness.BuildLLMEntry(0, harness.AnthropicToolUseResponse(
			"toolu_task_01", "task",
			map[string]any{
				"description":   "Provide a brief summary about renewable energy sources.",
				"subagent_type": "researcher",
			},
			250, 45,
		)),
		// Turn 2: Subagent (researcher) responds with text
		harness.BuildLLMEntry(1, harness.AnthropicTextResponse(
			"Renewable energy comes from naturally replenishing sources such as solar, wind, and hydroelectric power. "+
				"These sources produce minimal greenhouse gas emissions compared to fossil fuels.",
			180, 35,
		)),
		// Turn 3: Parent synthesizes the subagent's findings
		harness.BuildLLMEntry(2, harness.AnthropicTextResponse(
			"Based on the researcher's findings, renewable energy encompasses solar, wind, and hydroelectric sources "+
				"that offer environmental benefits over traditional fossil fuels.",
			350, 30,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := harness.CreateAgent(t, ctx, clients,
		"offline-subagent-"+t.Name(),
		"You are a project manager. When asked to research a topic, you MUST delegate to the researcher sub-agent using the task tool. Do not answer directly.",
		harness.WithSubAgent(&agentv1.SubAgent{
			Name:         "researcher",
			Description:  "Researches topics and provides concise summaries",
			Instructions: "You are a researcher. When given a topic, provide a brief 2-3 sentence summary. Be concise and factual.",
		}),
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
		"Please delegate to the researcher to summarize renewable energy.",
		harness.WithAutoApproveAll(true),
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "subagent execution should complete")
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	status := result.GetStatus()
	messages := status.GetMessages()

	// Execution should have multiple messages from delegation flow
	assert.GreaterOrEqual(t, len(messages), 2,
		"delegation should produce messages from parent and subagent; got %d", len(messages))

	// Look for the task tool call on the parent's AI message
	hasTaskToolCall := false
	for _, msg := range messages {
		for _, tc := range msg.GetToolCalls() {
			if tc.GetName() == "task" {
				hasTaskToolCall = true
				assert.NotEmpty(t, tc.GetResult(), "task tool call should have a result from the subagent")
				assert.Equal(t, agentexecv1.ToolCallStatus_TOOL_CALL_COMPLETED, tc.GetStatus(),
					"task tool call should be completed")
				break
			}
		}
	}
	assert.True(t, hasTaskToolCall,
		"parent should have a 'task' tool call for subagent delegation")

	// All mock entries consumed
	assert.Equal(t, 0, mockLLM.Remaining(),
		"all mock LLM entries should be consumed")

	subAgents := status.GetSubAgentExecutions()
	require.NotEmpty(t, subAgents,
		"sub_agent_executions must be populated — mock LLM always delegates via task tool")

	harness.AssertSubAgents(t, result, "researcher")

	for _, sa := range subAgents {
		harness.AssertSubAgentExecution(t, sa)
	}

	sa := harness.FindSubAgent(result, "researcher")
	require.NotNil(t, sa, "sub-agent 'researcher' must be present")
	assert.Equal(t, agentexecv1.SubAgentStatus_SUB_AGENT_COMPLETED, sa.GetStatus(),
		"researcher sub-agent should be COMPLETED")

	harness.LogSubAgentExecutions(t, result)

	t.Logf("subagent delegation test passed: messages=%d, task_tool=%v, sub_agents=%d, mock_consumed=%d",
		len(messages), hasTaskToolCall, len(subAgents), mockLLM.Consumed())
}

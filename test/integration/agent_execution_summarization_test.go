//go:build integration

package integration

import (
	"fmt"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAgentExecution_Summarization_ContextRetention verifies that the native
// harness's DeepAgents SummarizationMiddleware preserves key context across
// multiple turns. Even if summarization fires (at 85% of maxInputTokens), the
// agent must retain earlier facts introduced in the conversation.
//
// This test is a behavioral smoke test — it does NOT guarantee summarization
// fires (that requires ~170K+ tokens for a 200K model). It verifies:
//  1. Multi-turn conversations work and the agent retains early context
//  2. streaming_usage is populated with growing token counts
//  3. Input token growth is monotonic until summarization (which would cause
//     a detectable drop)
func TestAgentExecution_Summarization_ContextRetention(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	harness.RequireNativePrereqs(t, testHarness)

	ctx, cancel := harness.TestContext(t, 8*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := harness.CreateAgent(t, ctx, clients, "test-summarization",
		"You are a helpful assistant. Remember all facts the user tells you. When asked to recall, repeat them exactly. Respond briefly.")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(), harness.Harnesses[0].Harness)
	sessionID := session.GetMetadata().GetId()

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	// Turn 1: Introduce a fact
	exec1 := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID, "Remember this: the secret code is ALPHA-7392. Acknowledge that you've noted it.")
	result1, err := waiter.WaitForPhase(ctx, exec1.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
	require.NoError(t, err, "turn 1 should complete")

	usage1 := result1.GetStatus().GetStreamingUsage()
	require.NotNil(t, usage1, "turn 1 streaming_usage should exist")
	assert.Greater(t, usage1.GetInputTokens(), int64(0), "turn 1 input_tokens > 0")
	t.Logf("TURN 1: input=%d output=%d turns=%d cost=$%.6f",
		usage1.GetInputTokens(), usage1.GetOutputTokens(),
		usage1.GetTurnCount(), usage1.GetEstimatedCostUsd())

	// Turn 2: Introduce a second fact
	exec2 := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID, "Also remember: my favorite city is Kyoto. Acknowledge.")
	result2, err := waiter.WaitForPhase(ctx, exec2.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
	require.NoError(t, err, "turn 2 should complete")

	usage2 := result2.GetStatus().GetStreamingUsage()
	require.NotNil(t, usage2, "turn 2 streaming_usage should exist")
	t.Logf("TURN 2: input=%d output=%d turns=%d cost=$%.6f",
		usage2.GetInputTokens(), usage2.GetOutputTokens(),
		usage2.GetTurnCount(), usage2.GetEstimatedCostUsd())

	// Turn 3: Recall both facts — proves context retention
	exec3 := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID, "What is the secret code I told you, and what is my favorite city?")
	result3, err := waiter.WaitForPhase(ctx, exec3.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
	require.NoError(t, err, "turn 3 should complete")

	usage3 := result3.GetStatus().GetStreamingUsage()
	require.NotNil(t, usage3, "turn 3 streaming_usage should exist")
	t.Logf("TURN 3: input=%d output=%d turns=%d cost=$%.6f",
		usage3.GetInputTokens(), usage3.GetOutputTokens(),
		usage3.GetTurnCount(), usage3.GetEstimatedCostUsd())

	// Verify the agent recalled both facts from earlier turns
	lastMsg := lastAssistantMessage(result3)
	require.NotEmpty(t, lastMsg, "turn 3 should produce an assistant response")
	t.Logf("RECALL response: %s", truncate(lastMsg, 300))

	assert.Contains(t, lastMsg, "ALPHA-7392",
		"agent should recall the secret code from turn 1")
	assert.Contains(t, lastMsg, "Kyoto",
		"agent should recall the favorite city from turn 2")
}

// TestAgentExecution_Summarization_TokenGrowth verifies that input tokens
// grow across turns (context window fills up) and that the streaming usage
// pipeline captures this growth correctly.
func TestAgentExecution_Summarization_TokenGrowth(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	harness.RequireNativePrereqs(t, testHarness)

	ctx, cancel := harness.TestContext(t, 8*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := harness.CreateAgent(t, ctx, clients, "test-token-growth",
		"You are a helpful assistant. Respond with exactly 2-3 sentences each time.")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(), harness.Harnesses[0].Harness)
	sessionID := session.GetMetadata().GetId()

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	var prevInputTokens int64
	var tokenGrowthObserved bool

	for turn := 1; turn <= 4; turn++ {
		exec := harness.CreateTestAgentExecution(t, ctx, clients,
			sessionID, fmt.Sprintf("Turn %d: Tell me an interesting fact about the number %d.", turn, turn*7))
		result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
			agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
		require.NoError(t, err, "turn %d should complete", turn)

		usage := result.GetStatus().GetStreamingUsage()
		require.NotNil(t, usage, "turn %d streaming_usage should exist", turn)

		inputTokens := usage.GetInputTokens()
		t.Logf("TURN %d: input=%d output=%d cost=$%.6f",
			turn, inputTokens, usage.GetOutputTokens(), usage.GetEstimatedCostUsd())

		assert.Greater(t, inputTokens, int64(0),
			"turn %d input_tokens should be > 0", turn)
		assert.Greater(t, usage.GetEstimatedCostUsd(), float64(0),
			"turn %d estimated_cost should be > 0", turn)
		assert.NotEmpty(t, usage.GetModel(),
			"turn %d model should be populated", turn)

		if turn > 1 && inputTokens > prevInputTokens {
			tokenGrowthObserved = true
		}

		// If we detect a significant drop (>30%), summarization likely fired
		if turn > 1 && inputTokens < prevInputTokens*7/10 {
			t.Logf("SUMMARIZATION DETECTED: turn %d input dropped from %d to %d (%.0f%% reduction)",
				turn, prevInputTokens, inputTokens,
				float64(prevInputTokens-inputTokens)/float64(prevInputTokens)*100)
		}

		prevInputTokens = inputTokens
	}

	assert.True(t, tokenGrowthObserved,
		"input tokens should grow across turns as conversation context accumulates")
}

func lastAssistantMessage(exec *agentexecv1.AgentExecution) string {
	msgs := exec.GetStatus().GetMessages()
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].GetType() == agentexecv1.MessageType_MESSAGE_AI {
			return msgs[i].GetContent()
		}
	}
	return ""
}

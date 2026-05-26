//go:build integration

package offline

import (
	"context"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Golden Baseline: Plain Chat (no tools) ---
// Exercises the simplest native path scenario: single-turn text response.
// Validates message creation, usage accumulation, and COMPLETED lifecycle
// with no tool calls, no approval gates, and no structured output.

func TestOffline_PlainChat_SingleTurn(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")
	require.NotNil(t, grpcConn, "gRPC connection required")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse(
			"Hello! I'm your AI assistant. How can I help you today?",
			120, 18,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := harness.CreateAgent(t, ctx, clients,
		"offline-plain-chat-"+t.Name(),
		"You are a helpful assistant.",
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
		"Hello!",
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "plain chat execution should complete")

	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	status := result.GetStatus()

	// At least one AI message with text content
	hasAIMessage := false
	for _, msg := range status.GetMessages() {
		if msg.GetType() == agentexecv1.MessageType_MESSAGE_AI && msg.GetContent() != "" {
			hasAIMessage = true
			assert.False(t, msg.GetIsStreaming(), "AI message should not be streaming after completion")
			break
		}
	}
	assert.True(t, hasAIMessage, "should have at least one AI message with content")

	// No tool calls on any message
	for _, msg := range status.GetMessages() {
		assert.Empty(t, msg.GetToolCalls(), "plain chat should have no tool calls")
	}

	// Usage should be populated
	usage := status.GetStreamingUsage()
	if usage != nil {
		assert.True(t, usage.GetTurnCount() >= 1, "should have at least 1 turn")
	}

	assert.Equal(t, 0, mockLLM.Remaining(), "all mock LLM entries should be consumed")

	t.Logf("plain chat test passed: messages=%d, mock_consumed=%d",
		len(status.GetMessages()), mockLLM.Consumed())
}

// --- Golden Baseline: Anthropic Thinking Blocks ---
// Exercises the extended thinking path where the model emits thinking
// content blocks before the text answer. Validates that THINKING and
// AI messages are both present and correctly typed.

func TestOffline_AnthropicThinking_ThinkingAndText(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")
	require.NotNil(t, grpcConn, "gRPC connection required")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicThinkingTextResponse(
			"Let me think about this carefully. The user is asking a simple greeting question.",
			"Hello! I've thought about your question and I'm happy to help.",
			200, 45,
		)),
	}

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := harness.CreateAgent(t, ctx, clients,
		"offline-thinking-"+t.Name(),
		"You are a thoughtful assistant that reasons carefully.",
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
		"Think carefully and greet me.",
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	require.NoError(t, err, "thinking execution should complete")

	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	status := result.GetStatus()
	messages := status.GetMessages()

	// Should have both THINKING and AI messages
	hasThinking := false
	hasAI := false
	for _, msg := range messages {
		switch msg.GetType() {
		case agentexecv1.MessageType_MESSAGE_THINKING:
			hasThinking = true
			assert.NotEmpty(t, msg.GetContent(), "thinking message should have content")
		case agentexecv1.MessageType_MESSAGE_AI:
			if msg.GetContent() != "" {
				hasAI = true
			}
		}
	}

	assert.True(t, hasThinking, "should have a THINKING message")
	assert.True(t, hasAI, "should have an AI message with text content")

	// No tool calls
	for _, msg := range messages {
		assert.Empty(t, msg.GetToolCalls(), "thinking test should have no tool calls")
	}

	assert.Equal(t, 0, mockLLM.Remaining(), "all mock LLM entries should be consumed")

	t.Logf("thinking test passed: messages=%d (thinking=%v, ai=%v), mock_consumed=%d",
		len(messages), hasThinking, hasAI, mockLLM.Consumed())
}

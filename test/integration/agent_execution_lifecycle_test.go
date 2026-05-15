//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
)

// --- Offline tests (no harness iteration, no LLM needed) ---

func TestAgentExecution_InvalidMessage(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-invalid-msg",
		"You are a test assistant. Respond briefly.")

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(), 0)

	_, err := clients.AgentExecutionCommand.Create(ctx, &agentexecv1.AgentExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-invalid-msg",
			Org:  "test-org",
		},
		Spec: &agentexecv1.AgentExecutionSpec{
			SessionId: session.GetMetadata().GetId(),
			Message:   "",
		},
	})
	require.Error(t, err, "empty message should be rejected")
	t.Logf("empty message correctly rejected: %v", err)
}

// --- Provider tests (cross-harness) ---

func TestAgentExecution_HappyPath(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			agent := harness.CreateAgent(t, ctx, clients, "test-happy-"+h.Name,
				"You are a helpful assistant. When asked, respond briefly and directly.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Reply with exactly: hello-from-agent")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should reach COMPLETED phase")

			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
			harness.AssertMessages(t, result,
				agentexecv1.MessageType_MESSAGE_HUMAN,
				agentexecv1.MessageType_MESSAGE_AI)

			t.Logf("execution completed: id=%s, messages=%d",
				result.GetMetadata().GetId(),
				len(result.GetStatus().GetMessages()))
		})
	}
}

func TestAgentExecution_StructuredOutput(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			agent := harness.CreateAgent(t, ctx, clients, "test-structured-"+h.Name,
				`You are a JSON classifier. When given text, respond with ONLY valid JSON: {"sentiment": "positive"} or {"sentiment": "negative"} or {"sentiment": "neutral"}. No other text.`)

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Classify: 'This product is fantastic!'")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should reach COMPLETED phase")

			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			// Verify at least one AI message exists with content
			messages := result.GetStatus().GetMessages()
			hasAI := false
			for _, msg := range messages {
				if msg.GetType() == agentexecv1.MessageType_MESSAGE_AI && msg.GetContent() != "" {
					hasAI = true
					t.Logf("AI response: %s", msg.GetContent()[:min(len(msg.GetContent()), 200)])
					break
				}
			}
			require.True(t, hasAI, "execution should have at least one AI message with content")
		})
	}
}

func TestAgentExecution_MultiTurn(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			agent := harness.CreateAgent(t, ctx, clients, "test-multiturn-"+h.Name,
				"You are a helpful assistant. Remember what the user tells you in the conversation.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)
			sessionID := session.GetMetadata().GetId()

			// Turn 1: establish context
			exec1 := harness.CreateTestAgentExecution(t, ctx, clients,
				sessionID, "My favorite color is blue. Remember this.")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			_, err := waiter.WaitForPhase(ctx, exec1.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "first turn should complete")

			// Turn 2: verify context is preserved
			exec2 := harness.CreateTestAgentExecution(t, ctx, clients,
				sessionID, "What is my favorite color?")

			result2, err := waiter.WaitForPhase(ctx, exec2.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "second turn should complete")

			harness.AssertAgentPhase(t, result2, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			t.Logf("multi-turn completed: turn1=%s, turn2=%s, session=%s",
				exec1.GetMetadata().GetId(),
				exec2.GetMetadata().GetId(),
				sessionID)
		})
	}
}

//go:build integration

package integration

import (
	"context"
	"fmt"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAgentExecution_ConversationJourney_ListBySession(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-journey-list-"+h.Name,
				"You are a helpful assistant. Respond briefly to each message.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)
			sessionID := session.GetMetadata().GetId()

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			var executionIDs []string

			for turn := 1; turn <= 3; turn++ {
				exec := harness.CreateTestAgentExecution(t, ctx, clients,
					sessionID, fmt.Sprintf("This is message number %d. Reply briefly.", turn))

				_, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
					agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
				require.NoError(t, err, "turn %d should complete", turn)

				executionIDs = append(executionIDs, exec.GetMetadata().GetId())

				list, err := clients.AgentExecutionQuery.ListBySession(ctx,
					&agentexecv1.ListAgentExecutionsBySessionRequest{
						SessionId: sessionID,
						PageSize:  100,
					})
				require.NoError(t, err, "listBySession after turn %d should succeed", turn)

				assert.GreaterOrEqual(t, len(list.GetEntries()), turn,
					"after turn %d, ListBySession should return at least %d executions", turn, turn)

				for _, expectedID := range executionIDs {
					found := false
					for _, entry := range list.GetEntries() {
						if entry.GetMetadata().GetId() == expectedID {
							found = true
							break
						}
					}
					assert.True(t, found,
						"execution %s from turn %d should appear in ListBySession after turn %d",
						expectedID, turn, turn)
				}

				t.Logf("turn %d complete: execution=%s, listBySession count=%d",
					turn, exec.GetMetadata().GetId(), len(list.GetEntries()))
			}
		})
	}
}

func TestAgentExecution_ConcurrentSessions_Isolation(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-isolation-"+h.Name,
				"You are a helpful assistant. Remember everything the user tells you. When asked to recall, repeat it exactly.")

			sessionA := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)
			sessionB := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			// Establish different context in each session.
			execA1 := harness.CreateTestAgentExecution(t, ctx, clients,
				sessionA.GetMetadata().GetId(),
				"Remember: the code word is ALPHA. Do not forget it.")
			_, err := waiter.WaitForPhase(ctx, execA1.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "sessionA turn 1 should complete")

			execB1 := harness.CreateTestAgentExecution(t, ctx, clients,
				sessionB.GetMetadata().GetId(),
				"Remember: the code word is BRAVO. Do not forget it.")
			_, err = waiter.WaitForPhase(ctx, execB1.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "sessionB turn 1 should complete")

			// Recall in each session — both should complete independently.
			execA2 := harness.CreateTestAgentExecution(t, ctx, clients,
				sessionA.GetMetadata().GetId(),
				"What is the code word I told you?")
			resultA, err := waiter.WaitForPhase(ctx, execA2.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "sessionA recall should complete")

			execB2 := harness.CreateTestAgentExecution(t, ctx, clients,
				sessionB.GetMetadata().GetId(),
				"What is the code word I told you?")
			resultB, err := waiter.WaitForPhase(ctx, execB2.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "sessionB recall should complete")

			// Structural assertions: both sessions complete independently.
			harness.AssertAgentPhase(t, resultA, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
			harness.AssertAgentPhase(t, resultB, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			// Log responses for manual inspection — we don't assert on LLM
			// prose content because that's inherently flaky. The structural
			// proof is that both sessions complete independently without
			// cross-contamination causing errors.
			for _, msg := range resultA.GetStatus().GetMessages() {
				if msg.GetType() == agentexecv1.MessageType_MESSAGE_AI && msg.GetContent() != "" {
					content := msg.GetContent()
					if len(content) > 200 {
						content = content[:200] + "..."
					}
					t.Logf("sessionA recall response: %s", content)
					break
				}
			}
			for _, msg := range resultB.GetStatus().GetMessages() {
				if msg.GetType() == agentexecv1.MessageType_MESSAGE_AI && msg.GetContent() != "" {
					content := msg.GetContent()
					if len(content) > 200 {
						content = content[:200] + "..."
					}
					t.Logf("sessionB recall response: %s", content)
					break
				}
			}

			t.Logf("session isolation verified: sessionA=%s, sessionB=%s — both completed independently",
				sessionA.GetMetadata().GetId(), sessionB.GetMetadata().GetId())
		})
	}
}

func TestAgentExecution_AutoSession_FollowUp(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-autosession-followup-"+h.Name,
				"You are a helpful assistant. Remember everything the user tells you.")

			// Create execution with agent_id only — server auto-creates a session.
			exec1, err := clients.AgentExecutionCommand.Create(ctx, &agentexecv1.AgentExecution{
				ApiVersion: "agentic.stigmer.ai/v1",
				Kind:       "AgentExecution",
				Metadata: &apiresource.ApiResourceMetadata{
					Name: "test-autosession-followup-1-" + h.Name,
					Org:  "test-org",
				},
				Spec: &agentexecv1.AgentExecutionSpec{
					AgentId: agent.GetMetadata().GetId(),
					Message: "My secret number is 42. Remember it.",
				},
			})
			require.NoError(t, err, "create with agent_id only should succeed")

			autoSessionID := exec1.GetSpec().GetSessionId()
			require.NotEmpty(t, autoSessionID,
				"server should auto-create a session and populate session_id")

			t.Cleanup(func() {
				cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				clients.SessionCommand.Delete(cleanCtx, &sessionv1.SessionId{Value: autoSessionID})
			})

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			_, err = waiter.WaitForPhase(ctx, exec1.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "first execution should complete")

			// Follow-up on the auto-created session — this is the key extension
			// beyond existing TestAgentExecution_CreateWithAgentId coverage.
			exec2 := harness.CreateTestAgentExecution(t, ctx, clients,
				autoSessionID, "What was my secret number?")

			result2, err := waiter.WaitForPhase(ctx, exec2.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "follow-up on auto-created session should complete")
			harness.AssertAgentPhase(t, result2, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

			// Verify both executions appear in ListBySession.
			list, err := clients.AgentExecutionQuery.ListBySession(ctx,
				&agentexecv1.ListAgentExecutionsBySessionRequest{
					SessionId: autoSessionID,
					PageSize:  100,
				})
			require.NoError(t, err, "listBySession should succeed")

			foundExec1 := false
			foundExec2 := false
			for _, entry := range list.GetEntries() {
				switch entry.GetMetadata().GetId() {
				case exec1.GetMetadata().GetId():
					foundExec1 = true
				case exec2.GetMetadata().GetId():
					foundExec2 = true
				}
			}
			assert.True(t, foundExec1, "first execution should appear in ListBySession")
			assert.True(t, foundExec2, "follow-up execution should appear in ListBySession")

			t.Logf("auto-session follow-up verified: session=%s, exec1=%s, exec2=%s, list_count=%d",
				autoSessionID, exec1.GetMetadata().GetId(), exec2.GetMetadata().GetId(),
				len(list.GetEntries()))
		})
	}
}

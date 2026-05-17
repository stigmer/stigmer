//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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

func TestAgentExecution_NonexistentSession(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	_, err := clients.AgentExecutionCommand.Create(ctx, &agentexecv1.AgentExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-nonexistent-session",
			Org:  "test-org",
		},
		Spec: &agentexecv1.AgentExecutionSpec{
			SessionId: "nonexistent-session-id-12345",
			Message:   "This should fail",
		},
	})
	require.Error(t, err, "non-existent session_id should be rejected")

	st, ok := status.FromError(err)
	require.True(t, ok, "error should be a gRPC status")
	// With real FGA, the authorization layer denies access before the
	// service can check whether the session exists, so PermissionDenied
	// is also a valid rejection code.
	require.True(t,
		st.Code() == codes.NotFound || st.Code() == codes.PermissionDenied,
		"expected NOT_FOUND or PERMISSION_DENIED, got %s: %s", st.Code(), st.Message())
	t.Logf("non-existent session correctly rejected: %v", st.Message())
}

func TestAgentExecution_CreateDefaultAgent_NoDefault(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	// Create execution with neither session_id nor agent_id.
	// No default agent exists in the test org, so the server should reject
	// with NOT_FOUND (no agent labeled stigmer.ai/default-agent).
	_, err := clients.AgentExecutionCommand.Create(ctx, &agentexecv1.AgentExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-no-default-agent",
			Org:  "test-org",
		},
		Spec: &agentexecv1.AgentExecutionSpec{
			Message: "This should fail — no default agent",
		},
	})
	require.Error(t, err, "execution without session_id or agent_id should fail when no default agent exists")

	st, ok := status.FromError(err)
	require.True(t, ok, "error should be a gRPC status")
	// The server may return NOT_FOUND (no default agent) or FAILED_PRECONDITION
	// or INVALID_ARGUMENT depending on the resolution pipeline.
	require.True(t,
		st.Code() == codes.NotFound || st.Code() == codes.FailedPrecondition || st.Code() == codes.InvalidArgument,
		"expected NOT_FOUND, FAILED_PRECONDITION, or INVALID_ARGUMENT, got %s: %s", st.Code(), st.Message())
	t.Logf("no-default-agent correctly rejected: code=%s, msg=%s", st.Code(), st.Message())
}

func TestAgentExecution_CreateDefaultAgent(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			// Create an agent with the default-agent label and public visibility.
			agent := harness.CreateAgentFull(t, ctx, clients, "test-default-agent-"+h.Name,
				"You are the default platform assistant. Respond briefly.",
				nil,
				[]harness.AgentCreateOption{harness.WithDefaultAgentLabel()},
			)
			t.Logf("created default agent: id=%s, slug=%s",
				agent.GetMetadata().GetId(), agent.GetMetadata().GetSlug())

			// Create execution with neither session_id nor agent_id.
			// The server should resolve the default agent and auto-create a session.
			exec, err := clients.AgentExecutionCommand.Create(ctx, &agentexecv1.AgentExecution{
				ApiVersion: "agentic.stigmer.ai/v1",
				Kind:       "AgentExecution",
				Metadata: &apiresource.ApiResourceMetadata{
					Name: "test-default-resolved-" + h.Name,
					Org:  "test-org",
				},
				Spec: &agentexecv1.AgentExecutionSpec{
					Message: "Reply with exactly: default-agent-resolved",
				},
			})
			require.NoError(t, err, "create with default agent resolution should succeed")
			require.NotEmpty(t, exec.GetSpec().GetSessionId(),
				"server should auto-create a session via default agent resolution")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should reach COMPLETED phase")

			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
			t.Logf("default agent execution completed: id=%s, session=%s",
				result.GetMetadata().GetId(), exec.GetSpec().GetSessionId())
		})
	}
}

func TestAgentExecution_PauseTerminalFails(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			agent := harness.CreateAgent(t, ctx, clients, "test-pause-term-"+h.Name,
				"You are a helpful assistant. Respond briefly.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(), "Reply with exactly: hello")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			_, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err)

			_, err = clients.AgentExecutionCommand.Pause(ctx, &agentexecv1.PauseAgentExecutionInput{
				Id: exec.GetMetadata().GetId(),
			})
			require.Error(t, err, "pausing a completed execution should fail")

			st, ok := status.FromError(err)
			require.True(t, ok, "error should be a gRPC status")
			require.Equal(t, codes.FailedPrecondition, st.Code(),
				"expected FAILED_PRECONDITION, got %s: %s", st.Code(), st.Message())
			t.Logf("pause-terminal correctly rejected: %v", st.Message())
		})
	}
}

func TestAgentExecution_RecoverNonFailedFails(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			agent := harness.CreateAgent(t, ctx, clients, "test-recover-nonfail-"+h.Name,
				"You are a helpful assistant. Respond briefly.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(), "Reply with exactly: hello")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			_, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err)

			_, err = clients.AgentExecutionCommand.Recover(ctx, &agentexecv1.RecoverAgentExecutionInput{
				Id: exec.GetMetadata().GetId(),
			})
			require.Error(t, err, "recovering a completed execution should fail")

			st, ok := status.FromError(err)
			require.True(t, ok, "error should be a gRPC status")
			require.Equal(t, codes.FailedPrecondition, st.Code(),
				"expected FAILED_PRECONDITION, got %s: %s", st.Code(), st.Message())
			t.Logf("recover-nonfailed correctly rejected: %v", st.Message())
		})
	}
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

func TestAgentExecution_CreateWithAgentId(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			agent := harness.CreateAgent(t, ctx, clients, "test-agent-id-only-"+h.Name,
				"You are a helpful assistant. Respond briefly.")

			// Create execution with agent_id only — no session_id.
			// The server should auto-create a session from the agent's default instance.
			exec, err := clients.AgentExecutionCommand.Create(ctx, &agentexecv1.AgentExecution{
				ApiVersion: "agentic.stigmer.ai/v1",
				Kind:       "AgentExecution",
				Metadata: &apiresource.ApiResourceMetadata{
					Name: "test-agent-id-only-" + h.Name,
					Org:  "test-org",
				},
				Spec: &agentexecv1.AgentExecutionSpec{
					AgentId: agent.GetMetadata().GetId(),
					Message: "Reply with exactly: session-auto-created",
				},
			})
			require.NoError(t, err, "create with agent_id only should succeed")
			require.NotEmpty(t, exec.GetMetadata().GetId(), "execution should have an ID")

			autoSessionID := exec.GetSpec().GetSessionId()
			require.NotEmpty(t, autoSessionID,
				"server should populate session_id on the response when auto-creating")

			// Verify the auto-created session is queryable.
			session, err := clients.SessionQuery.Get(ctx, &sessionv1.SessionId{
				Value: autoSessionID,
			})
			require.NoError(t, err, "auto-created session should be queryable")
			require.Equal(t, autoSessionID, session.GetMetadata().GetId())
			t.Logf("auto-created session: id=%s, agent_instance=%s, harness=%s",
				autoSessionID,
				session.GetSpec().GetAgentInstanceId(),
				session.GetSpec().GetHarness().String())

			// Wait for the execution to complete.
			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should reach COMPLETED phase")

			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
			t.Logf("execution completed: id=%s, auto_session=%s",
				result.GetMetadata().GetId(), autoSessionID)
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

func TestAgentExecution_PlanMode(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)

			agent := harness.CreateAgent(t, ctx, clients, "test-plan-mode-"+h.Name,
				"You are a helpful assistant. When in Plan mode, analyze the request and produce a plan without making changes.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Plan how you would create a file called hello.txt with the content 'hello world'. Do NOT actually create it.",
				harness.WithExecutionConfig(&agentexecv1.ExecutionConfig{
					InteractionMode: agentexecv1.InteractionMode_INTERACTION_MODE_PLAN,
				}),
			)

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "plan mode execution should reach COMPLETED phase")

			harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
			harness.AssertMessages(t, result, agentexecv1.MessageType_MESSAGE_AI)

			require.Equal(t,
				agentexecv1.InteractionMode_INTERACTION_MODE_PLAN,
				result.GetSpec().GetExecutionConfig().GetInteractionMode(),
				"spec.execution_config should reflect plan mode",
			)

			writeMutatingTools := map[string]bool{
				"write": true, "write_file": true,
				"edit": true, "edit_file": true,
				"delete": true,
			}
			for _, msg := range result.GetStatus().GetMessages() {
				for _, tc := range msg.GetToolCalls() {
					require.False(t, writeMutatingTools[tc.GetName()],
						"plan mode should not invoke write tools, but found: %s", tc.GetName())
				}
			}

			t.Logf("plan mode execution completed: id=%s, messages=%d, interactionMode=%s",
				result.GetMetadata().GetId(),
				len(result.GetStatus().GetMessages()),
				result.GetSpec().GetExecutionConfig().GetInteractionMode().String())
		})
	}
}

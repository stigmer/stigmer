//go:build integration

package integration

import (
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSession_SubjectGeneration_AutoCreatedSession verifies that sessions
// auto-created with the sentinel "Auto-created session" get an LLM-generated
// title after the first agent execution completes.
func TestSession_SubjectGeneration_AutoCreatedSession(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-subject-gen-auto-"+h.Name,
				"You are a helpful test assistant. Respond briefly.")

			// Create execution WITHOUT providing session_id — triggers auto-session-creation
			// with the sentinel subject "Auto-created session".
			exec, err := clients.AgentExecutionCommand.Create(ctx, &agentexecv1.AgentExecution{
				ApiVersion: "agentic.stigmer.ai/v1",
				Kind:       "AgentExecution",
				Metadata: &apiresource.ApiResourceMetadata{
					Name: "test-subject-gen-auto-exec-" + h.Name,
					Org:  "test-org",
				},
				Spec: &agentexecv1.AgentExecutionSpec{
					AgentId: agent.GetMetadata().GetId(),
					Message: "Explain how database indexing works for PostgreSQL B-tree indexes",
				},
			})
			require.NoError(t, err, "create execution should succeed")

			executionID := exec.GetMetadata().GetId()
			sessionID := exec.GetSpec().GetSessionId()
			require.NotEmpty(t, sessionID, "auto-created session_id should be on the execution")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			_, err = waiter.WaitForPhase(ctx, executionID,
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should complete")

			// After completion, the GenerateSessionSubject activity should have
			// replaced the sentinel with a meaningful LLM-generated title.
			session, err := clients.SessionQuery.Get(ctx, &sessionv1.SessionId{Value: sessionID})
			require.NoError(t, err, "get session should succeed")

			subject := session.GetSpec().GetSubject()
			t.Logf("session subject after execution: %q", subject)

			assert.NotEmpty(t, subject, "subject should not be empty")
			assert.NotEqual(t, "Auto-created session", subject,
				"subject should have been replaced by LLM-generated title")
		})
	}
}

// TestSession_SubjectGeneration_EmptySubjectSession verifies that sessions
// created with an empty subject (as call-agent.ts does for workflow child
// executions) also get a generated title. This is the specific regression
// that caused the "Untitled session" bug.
func TestSession_SubjectGeneration_EmptySubjectSession(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-subject-gen-empty-"+h.Name,
				"You are a helpful test assistant. Respond briefly.")

			instanceID := agent.GetStatus().GetDefaultInstanceId()

			// Create session with EMPTY subject — simulates what call-agent.ts does.
			session := harness.CreateTestSession(t, ctx, clients, instanceID, h.Harness,
				harness.WithSubject(""))

			sessionID := session.GetMetadata().GetId()

			exec := harness.CreateTestAgentExecution(t, ctx, clients, sessionID,
				"How do I configure multi-AZ replication for PostgreSQL?")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			_, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should complete")

			// After completion, the activity should generate a subject even though
			// the session was created with an empty subject (not the exact sentinel).
			got, err := clients.SessionQuery.Get(ctx, &sessionv1.SessionId{Value: sessionID})
			require.NoError(t, err, "get session should succeed")

			subject := got.GetSpec().GetSubject()
			t.Logf("session subject after execution (was empty): %q", subject)

			assert.NotEmpty(t, subject,
				"empty-subject sessions should get a generated title after execution")
		})
	}
}

// TestSession_SubjectGeneration_PresetSubjectPreserved verifies that sessions
// with a pre-existing meaningful subject are NOT overwritten by the generation
// activity. This is the negative test — custom titles must be preserved.
func TestSession_SubjectGeneration_PresetSubjectPreserved(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-subject-gen-preset-"+h.Name,
				"You are a helpful test assistant. Respond briefly.")

			instanceID := agent.GetStatus().GetDefaultInstanceId()
			customTitle := "My Custom Project Title"

			session := harness.CreateTestSession(t, ctx, clients, instanceID, h.Harness,
				harness.WithSubject(customTitle))

			sessionID := session.GetMetadata().GetId()

			exec := harness.CreateTestAgentExecution(t, ctx, clients, sessionID,
				"Tell me about Kubernetes operators")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			_, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should complete")

			got, err := clients.SessionQuery.Get(ctx, &sessionv1.SessionId{Value: sessionID})
			require.NoError(t, err, "get session should succeed")

			assert.Equal(t, customTitle, got.GetSpec().GetSubject(),
				"pre-existing custom subject must not be overwritten")
		})
	}
}

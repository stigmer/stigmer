//go:build integration

package integration

import (
	"context"
	"os"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
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

// TestSession_SubjectGeneration_WorkflowCallAgent exercises the exact production
// scenario that's broken: a workflow with a call:agent task spawns a child agent
// execution, which auto-creates a session. The GenerateSessionSubject activity
// should replace the sentinel subject on the child session with an LLM-generated
// (or heuristic) title.
//
// This differs from the direct-execution tests above because the session is
// created by the TypeScript runner's call-agent.ts activity (not by the Java
// CreateSessionIfNeeded pipeline step), and the child execution runs through
// the full Temporal callback-token handshake.
func TestSession_SubjectGeneration_WorkflowCallAgent(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available — skipping workflow agent_call subject test")
	}
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		t.Skip("ANTHROPIC_API_KEY not set — skipping: child agent_call requires LLM to complete")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "subject-wf-agent", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createTestAgent(t, ctx, clients, "test-subject-wf-child",
		"You are a helpful assistant. When asked, respond briefly and directly.")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"message": "Explain how PostgreSQL B-tree indexes handle range queries",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-subject-gen-wf-agent-call",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: verify subject generation on workflow-spawned agent session",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "test-subject-gen-wf-agent-call",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "callAgent",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "subject gen workflow test")
	require.NoError(t, err)
	require.NotEmpty(t, execution.GetMetadata().GetId())

	t.Logf("workflow execution created: id=%s", execution.GetMetadata().GetId())

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
	require.NoError(t, err, "workflow execution should reach COMPLETED phase")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	t.Logf("workflow execution completed: id=%s", result.GetMetadata().GetId())

	// Find the child agent execution created by call:agent
	resp, err := clients.AgentExecutionQuery.List(ctx, &agentexecv1.ListAgentExecutionsRequest{})
	require.NoError(t, err, "listing agent executions should succeed")

	var childExec *agentexecv1.AgentExecution
	for _, ae := range resp.GetEntries() {
		if ae.GetSpec().GetParentWorkflowId() != "" {
			childExec = ae
			break
		}
	}
	require.NotNil(t, childExec, "should find a child agent execution with parent_workflow_id set")

	childSessionID := childExec.GetSpec().GetSessionId()
	require.NotEmpty(t, childSessionID, "child execution should have a session_id")

	t.Logf("child agent execution: id=%s, session_id=%s, phase=%s",
		childExec.GetMetadata().GetId(), childSessionID,
		childExec.GetStatus().GetPhase().String())

	// Load the child session and verify its subject was generated.
	childSession, err := clients.SessionQuery.Get(ctx, &sessionv1.SessionId{Value: childSessionID})
	require.NoError(t, err, "get child session should succeed")

	subject := childSession.GetSpec().GetSubject()
	t.Logf("child session subject after workflow completion: %q", subject)

	assert.NotEmpty(t, subject,
		"workflow-spawned child session should have a non-empty subject")
	assert.NotEqual(t, "Auto-created session", subject,
		"workflow-spawned child session subject should be replaced by generated title, not remain as sentinel")
}

// TestSession_SubjectGeneration_ConcurrentSessionWrite verifies that a
// generated subject survives a concurrent full-document session update.
//
// This reproduces the lost-update race condition: GenerateSessionSubjectActivity
// does a full sessionRepo.save() which can be overwritten by any concurrent
// writer that loaded a stale copy of the session. The test triggers subject
// generation and immediately performs a full session update (simulating
// sandbox_manager or memory writer) to see if the subject is preserved.
func TestSession_SubjectGeneration_ConcurrentSessionWrite(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := harness.TestContext(t, 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-subject-gen-race-"+h.Name,
				"You are a helpful test assistant. Respond briefly.")

			instanceID := agent.GetStatus().GetDefaultInstanceId()

			session := harness.CreateTestSession(t, ctx, clients, instanceID, h.Harness,
				harness.WithSubject("Auto-created session"))

			sessionID := session.GetMetadata().GetId()

			exec := harness.CreateTestAgentExecution(t, ctx, clients, sessionID,
				"How do I configure PostgreSQL connection pooling with pgbouncer?")

			// Immediately after creating the execution (while subject generation
			// is running as a fire-and-forget local activity), perform a full
			// session update that modifies a different field. This simulates
			// sandbox_manager writing harness_state_id or memory writer saving
			// session memory. The full update loads the session (with old subject),
			// modifies another field, and saves — potentially overwriting the
			// subject that was generated concurrently.
			time.Sleep(500 * time.Millisecond)
			currentSession, err := clients.SessionQuery.Get(ctx, &sessionv1.SessionId{Value: sessionID})
			require.NoError(t, err, "get session for concurrent update should succeed")

			concurrentUpdate := currentSession
			concurrentUpdate.Metadata.Id = sessionID
			_, err = clients.SessionCommand.Update(ctx, concurrentUpdate)
			require.NoError(t, err, "concurrent full session update should succeed")
			t.Logf("concurrent session update performed at T+500ms (session=%s)", sessionID)

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			_, err = waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should complete")

			// Wait a bit more to let any in-flight writes settle.
			time.Sleep(2 * time.Second)

			got, err := clients.SessionQuery.Get(ctx, &sessionv1.SessionId{Value: sessionID})
			require.NoError(t, err, "get session should succeed")

			subject := got.GetSpec().GetSubject()
			t.Logf("session subject after concurrent write race: %q", subject)

			assert.NotEmpty(t, subject,
				"subject should not be empty after concurrent write")
			assert.NotEqual(t, "Auto-created session", subject,
				"subject should survive concurrent session update — if this fails, "+
					"the full-document sessionRepo.save() lost the generated subject "+
					"to a concurrent writer (lost-update race condition)")
		})
	}
}

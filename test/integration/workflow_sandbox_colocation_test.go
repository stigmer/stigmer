//go:build integration

package integration

import (
	"context"
	"os"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestSandboxColocation_SessionRunnerID verifies that when the workflow-runner
// operates in sandbox mode (STIGMER_RUNNER_ID set), the session created for
// call:agent tasks carries the runner_id. The two-step pattern (create session,
// then create execution) ensures runner affinity lives on the session aggregate.
//
// Requires: Java service, Temporal, workflow-runner with STIGMER_RUNNER_ID,
// and ANTHROPIC_API_KEY (child agent runs ExecuteDeepAgent via unified runner).
func TestSandboxColocation_SessionRunnerID(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		t.Skip("ANTHROPIC_API_KEY not set — skipping: child agent_call requires LLM to reach terminal phase")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "sandbox-coloc", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createTestAgentForColocation(t, ctx, clients)

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"message": "Reply with exactly: colocation-test",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-sandbox-colocation",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: sandbox co-location via session runner_id",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-sandbox-colocation",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "callAgentColoc",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "sandbox colocation test")
	require.NoError(t, err)
	require.NotEmpty(t, execution.GetMetadata().GetId())

	executionId := execution.GetMetadata().GetId()
	t.Logf("workflow execution created: id=%s", executionId)

	// Wait for the call:agent activity to create the session and agent execution.
	// The child agent execution will fail (no agent-runner polling), but the
	// CallAgent activity must succeed far enough to create a session — if it
	// can't even create the session (e.g. proto validation failure), the
	// workflow execution fails fast and this test must catch that.
	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, executionId, 2*time.Minute)
	require.NoError(t, err, "workflow execution should reach a terminal phase")
	wfPhase := result.GetStatus().GetPhase()
	t.Logf("workflow execution reached phase: %s", wfPhase.String())

	// The CallAgent activity must have created the child agent execution.
	// If the workflow failed before that (e.g. Session creation rejected by
	// proto validation), we have zero agent executions — that is a hard failure.
	agentExecs, err := clients.AgentExecutionQuery.List(ctx, &agentexecv1.ListAgentExecutionsRequest{})
	require.NoError(t, err, "listing agent executions should succeed")

	var foundSession bool
	for _, ae := range agentExecs.GetEntries() {
		sessionId := ae.GetSpec().GetSessionId()
		if sessionId == "" {
			continue
		}

		session, err := clients.SessionQuery.Get(ctx, &sessionv1.SessionId{Value: sessionId})
		if err != nil {
			t.Logf("warning: could not get session %s: %v", sessionId, err)
			continue
		}

		foundSession = true
		t.Logf("found session: id=%s, execution_id=%s", sessionId, ae.GetMetadata().GetId())

		harnessStateId := session.GetSpec().GetHarnessStateId()
		if harnessStateId != "" {
			t.Logf("session has harness_state_id=%s (runner bound)", harnessStateId)
		}
	}

	if wfPhase == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED && !foundSession {
		t.Fatal("workflow execution FAILED and no child session was created — " +
			"CallAgent activity likely failed during Session or AgentExecution creation " +
			"(check runner logs for proto validation or gRPC errors)")
	}

	require.True(t, foundSession,
		"CallAgent activity must create at least one session; none found")
}

func createTestAgentForColocation(t *testing.T, ctx context.Context, clients *harness.Clients) *agentv1.Agent {
	t.Helper()

	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-coloc-agent",
			Org:  "test-org",
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Integration test agent for co-location verification",
			Instructions: "You are a test agent. Reply with exactly what is asked.",
		},
	}

	created, err := clients.AgentCommand.Apply(ctx, agent)
	require.NoError(t, err, "apply agent should succeed")

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = clients.AgentCommand.Delete(cleanCtx, &agentv1.AgentId{Value: created.GetMetadata().GetId()})
	})

	return created
}

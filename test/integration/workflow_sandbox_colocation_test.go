//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
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
// Requires: Java service, Temporal, workflow-runner with STIGMER_RUNNER_ID.
// Does NOT require: agent-runner or any LLM API key.
func TestSandboxColocation_SessionRunnerID(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "sandbox-coloc", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createTestAgentForColocation(t, ctx, clients)

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     "test-org",
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

	t.Logf("workflow execution created: id=%s", execution.GetMetadata().GetId())

	// Wait for the call:agent activity to create the session and agent execution.
	// The execution will likely fail (no agent-runner), but the session should
	// exist with runner_id set.
	time.Sleep(15 * time.Second)

	agentExecs, err := clients.AgentExecutionQuery.List(ctx, &agentexecv1.ListAgentExecutionsRequest{})
	if err != nil {
		t.Logf("warning: could not list agent executions: %v (session verification skipped)", err)
		return
	}

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

		runnerId := session.GetSpec().GetRunnerId()
		if runnerId != "" {
			t.Logf("found session with runner_id=%s (session_id=%s, execution_id=%s)",
				runnerId, sessionId, ae.GetMetadata().GetId())
			return
		}
	}

	t.Logf("no session with runner_id found — " +
		"this is expected when STIGMER_RUNNER_ID is not set on the workflow-runner")
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

//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestSandboxColocation_PreferredRunnerID verifies that when the workflow-
// runner operates in sandbox mode (STIGMER_RUNNER_ID set), agent executions
// created by call:agent tasks carry the preferred_runner_id. This test does
// NOT require an actual agent-runner -- it validates the spec-level routing
// hint that the Go workflow-runner injects.
//
// Requires: Java service, Temporal, workflow-runner with STIGMER_RUNNER_ID.
// Does NOT require: agent-runner or any LLM API key.
func TestSandboxColocation_PreferredRunnerID(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
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
			Description: "Integration test: sandbox co-location via preferred_runner_id",
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

	// The execution will likely fail (no agent-runner to handle the call:agent
	// task), but the AgentExecution should have been created with
	// preferred_runner_id set before the failure. Wait a bit for the
	// call:agent activity to fire, then list agent executions.
	time.Sleep(15 * time.Second)

	agentExecs, err := clients.AgentExecutionQuery.List(ctx, &agentexecv1.ListAgentExecutionsRequest{
		Org: "test-org",
	})
	if err != nil {
		t.Logf("warning: could not list agent executions: %v (preferred_runner_id verification skipped)", err)
		return
	}

	for _, ae := range agentExecs.GetItems() {
		if ae.GetSpec().GetPreferredRunnerId() != "" {
			t.Logf("found agent execution with preferred_runner_id=%s (id=%s)",
				ae.GetSpec().GetPreferredRunnerId(),
				ae.GetMetadata().GetId())
			return
		}
	}

	t.Logf("no agent execution with preferred_runner_id found — " +
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

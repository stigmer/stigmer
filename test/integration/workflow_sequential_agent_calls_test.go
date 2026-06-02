//go:build integration

package integration

import (
	"testing"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflow_SequentialCursorAgentCalls verifies that a workflow with two
// sequential agent_call tasks (cursor harness) completes successfully.
//
// This exercises the transport lifecycle between consecutive ExecuteCursor
// activities: the first task's HTTP/2 session must not poison the second.
// Historically, REFUSED_STREAM errors from the BiDi proxy during task #1
// degraded the h2 connection, causing task #2 to timeout with 0 messages.
//
// Requires CURSOR_API_KEY — exercises the full Cursor SDK path through
// the BiDi proxy with real LLM calls.
func TestWorkflow_SequentialCursorAgentCalls(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 8*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "seq-cursor", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createTestAgentForCursor(t, ctx, clients, "test-seq-cursor-agent",
		"You are a test agent. When asked to respond, reply with exactly one short sentence.")

	task1Config, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     harness.TestOrg,
		"message": "Reply with: task-one-complete",
		"harness": "cursor",
	})
	require.NoError(t, err)

	task2Config, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     harness.TestOrg,
		"message": "Reply with: task-two-complete",
		"harness": "cursor",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-sequential-cursor-calls",
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: two sequential cursor agent_call tasks",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      "integration-test-sequential-cursor-calls",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "firstCall",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: task1Config,
					Export:     &workflowv1.Export{As: "${ . }"},
					Flow:       &workflowv1.FlowControl{Then: "secondCall"},
				},
				{
					Name:       "secondCall",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: task2Config,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "sequential cursor calls test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution created: id=%s", executionID)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, executionID, 7*time.Minute)
	require.NoError(t, err, "execution should reach terminal phase")

	phase := result.GetStatus().GetPhase()
	t.Logf("execution terminal phase: %s", phase.String())

	assert.Equal(t,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		phase,
		"both sequential cursor agent_call tasks should complete successfully; "+
			"EXECUTION_FAILED indicates the second task could not establish its agent stream",
	)
}

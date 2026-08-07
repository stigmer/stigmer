//go:build integration

package integration

import (
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflowAgentCall_RunConfigReachesExecution verifies the #358 honesty
// contract end-to-end: a run_config declared on an agent_call task must
// arrive on the created child AgentExecution's ExecutionConfig — max_cost_usd
// and max_tool_rounds land on the fields the runner's cost/tool-round guards
// actually enforce.
//
// Before #358 no config knob except the model ever reached the execution: a
// workflow author who set a cost cap got no cap. This test is the regression
// guard for that class of silent drop.
func TestWorkflowAgentCall_RunConfigReachesExecution(t *testing.T) {
	requireAgentCallPrereqs(t)

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "run-config", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createTestAgent(t, ctx, clients, "test-run-config-agent",
		"You are a helpful assistant. Reply briefly with exactly: run-config-ok")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"message": "Reply with exactly: run-config-ok",
		"run_config": map[string]any{
			"max_cost_usd":    0.5,
			"max_tool_rounds": 15,
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-run-config",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: agent_call run_config reaches the child execution",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-run-config",
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

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "run config test")
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution created: id=%s", executionID)

	collector := harness.NewEventCollector(clients.ExecutionQuery, executionID, suiteLogger)
	err = collector.Start(ctx)
	require.NoError(t, err)
	defer collector.Stop()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForTerminal(ctx, executionID, 4*time.Minute)
	require.NoError(t, err, "execution should reach a terminal phase")

	time.Sleep(2 * time.Second)

	// The child execution id arrives via agent_call progress/completed events.
	var childExecID string
	for _, evt := range collector.AllEvents() {
		switch evt.GetEventType() {
		case workflowexecutionv1.WorkflowEventType_agent_call_progress:
			if id := evt.GetAgentCallProgress().GetChildExecutionId(); id != "" {
				childExecID = id
			}
		case workflowexecutionv1.WorkflowEventType_agent_call_completed:
			if p := evt.GetAgentCallCompleted(); p != nil && p.GetChildExecutionId() != "" {
				childExecID = p.GetChildExecutionId()
			}
		}
	}
	require.NotEmpty(t, childExecID,
		"an agent_call progress/completed event must carry the child_execution_id")

	childExec, err := clients.AgentExecutionQuery.Get(ctx,
		&agentexecv1.AgentExecutionId{Value: childExecID})
	require.NoError(t, err, "child AgentExecution should be fetchable by ID")

	execConfig := childExec.GetSpec().GetExecutionConfig()
	require.NotNil(t, execConfig,
		"child AgentExecution must carry an ExecutionConfig when run_config is set")
	assert.InDelta(t, 0.5, execConfig.GetMaxCostUsd(), 1e-9,
		"run_config.max_cost_usd must land on ExecutionConfig.max_cost_usd — "+
			"this is the field the runner's cost guards enforce")
	assert.Equal(t, int32(15), execConfig.GetMaxToolRounds(),
		"run_config.max_tool_rounds must land on ExecutionConfig.max_tool_rounds")
}

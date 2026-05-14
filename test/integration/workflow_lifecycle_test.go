//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestWorkflowLifecycle_SetTask_Completes(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available — cannot run execution tests")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "set-task", suiteLogger)
	defer deployer.Cleanup(ctx)

	taskConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"greeting": "hello-from-integration-test",
			"version":  "1.0.0",
		},
	})
	require.NoError(t, err, "task config struct creation should succeed")

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-set-vars",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: single set_vars task",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-set-vars",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "setGreeting",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: taskConfig,
					Export:     &workflowv1.Export{As: "${.}"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "integration test trigger")
	require.NoError(t, err, "deploy and execute should succeed")
	require.NotEmpty(t, execution.GetMetadata().GetId(), "execution should have an ID")

	t.Logf("execution created: id=%s, phase=%s",
		execution.GetMetadata().GetId(),
		execution.GetStatus().GetPhase().String(),
	)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err, "execution should reach COMPLETED phase")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "setGreeting", workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	t.Logf("execution completed: id=%s, tasks=%d",
		result.GetMetadata().GetId(),
		len(result.GetStatus().GetTasks()),
	)
}

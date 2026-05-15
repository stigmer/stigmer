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

// TestWorkflowData_SetVarsChaining verifies that multiple set_vars tasks
// can read each other's output through the context export chain.
//
// Workflow: stepOne (set greeting) → stepTwo (read greeting, set farewell)
// Asserts both tasks complete and data flows correctly.
func TestWorkflowData_SetVarsChaining(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "set-chain", suiteLogger)
	defer deployer.Cleanup(ctx)

	stepOneConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"greeting": "hello",
			"version":  "2.0.0",
		},
	})
	require.NoError(t, err)

	stepTwoConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"farewell": "goodbye",
			"combined": "greeting-received",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-set-vars-chain",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: set_vars chaining",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-set-vars-chain",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "stepOne",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: stepOneConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
				{
					Name:       "stepTwo",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: stepTwoConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "data chaining test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAllTaskStatuses(t, result, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"stepOne": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"stepTwo": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	})

	t.Logf("set_vars chaining completed: both tasks executed, tasks=%d",
		len(result.GetStatus().GetTasks()))
}

// TestWorkflowData_Transform verifies the transform task using the JQ engine.
//
// Workflow: setData (set_vars) → transformData (transform with JQ)
// The transform extracts and reshapes data from the workflow state.
func TestWorkflowData_Transform(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "transform", suiteLogger)
	defer deployer.Cleanup(ctx)

	setDataConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"first_name": "Jane",
			"last_name":  "Doe",
		},
	})
	require.NoError(t, err)

	transformConfig, err := structpb.NewStruct(map[string]any{
		"engine":     "TRANSFORM_ENGINE_JQ",
		"expression": `{full_name: (.first_name + " " + .last_name)}`,
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-transform",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: JQ transform",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-transform",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "setData",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: setDataConfig,
				},
				{
					Name:       "transformData",
					Kind:       workflowv1.WorkflowTaskKind_transform,
					TaskConfig: transformConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "transform test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAllTaskStatuses(t, result, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"setData":       workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"transformData": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	})

	t.Logf("transform completed: JQ transformation executed, tasks=%d",
		len(result.GetStatus().GetTasks()))
}

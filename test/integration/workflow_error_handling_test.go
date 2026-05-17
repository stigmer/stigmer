//go:build integration

package integration

import (
	"context"
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

// TestWorkflowError_RaiseError verifies that a raise_error task
// causes the workflow execution to reach EXECUTION_FAILED phase.
func TestWorkflowError_RaiseError(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "raise-err", suiteLogger)
	defer deployer.Cleanup(ctx)

	raiseConfig, err := structpb.NewStruct(map[string]any{
		"error":   "ValidationError",
		"message": "deliberately raised for testing",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-raise-error",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: raise_error causes failure",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-raise-error",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "failDeliberately",
					Kind:       workflowv1.WorkflowTaskKind_raise_error,
					TaskConfig: raiseConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "raise error test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, execution.GetMetadata().GetId(), 90*time.Second)
	require.NoError(t, err, "should reach a terminal phase")

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED)
	harness.AssertTaskStatus(t, result, "failDeliberately",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED)

	t.Logf("raise_error completed: execution correctly reached FAILED phase")
}

// TestWorkflowError_TryCatch verifies that a raise_error inside a try
// block is caught by the catch block, and the overall workflow completes.
func TestWorkflowError_TryCatch(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "try-catch", suiteLogger)
	defer deployer.Cleanup(ctx)

	// Build the nested task_config for try_catch.
	// try: [raise_error task]
	// catch: { as: "error", do: [set_vars task that records the error was caught] }
	tryCatchConfig, err := structpb.NewStruct(map[string]any{
		"try": []any{
			map[string]any{
				"name": "riskyTask",
				"kind": "raise_error",
				"task_config": map[string]any{
					"error":   "ValidationError",
					"message": "intentional failure in try block",
				},
			},
		},
		"catch": map[string]any{
			"as": "error",
			"do": []any{
				map[string]any{
					"name": "handleError",
					"kind": "set_vars",
					"task_config": map[string]any{
						"variables": map[string]any{
							"error_handled": "true",
						},
					},
				},
			},
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-try-catch",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: try_catch error handling",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-try-catch",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "safeOperation",
					Kind:       workflowv1.WorkflowTaskKind_try_catch,
					TaskConfig: tryCatchConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "try catch test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("try_catch completed: catch block handled the error, tasks=%d",
		len(result.GetStatus().GetTasks()))
}

// TestWorkflowError_InvalidConfig verifies that submitting a workflow
// with missing required configuration is rejected at apply time.
func TestWorkflowError_InvalidConfig(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "bad-config", suiteLogger)
	defer deployer.Cleanup(ctx)

	emptyConfig, err := structpb.NewStruct(map[string]any{})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-invalid-config",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: invalid task config",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-invalid-config",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "badTask",
					Kind:       workflowv1.WorkflowTaskKind_http_call,
					TaskConfig: emptyConfig,
				},
			},
		},
	}

	_, err = deployer.ApplyWorkflow(ctx, workflow)
	assert.Error(t, err, "applying a workflow with invalid config should fail")
	t.Logf("invalid config correctly rejected: %v", err)
}

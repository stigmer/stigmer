//go:build integration

package integration

import (
	"context"
	"sync"
	"testing"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflowPipeline_LinearMultiStep validates a multi-stage pipeline
// combining several task types in sequence:
//
//	initVars (set_vars) → routeByPriority (switch_case)
//	  ├─ priority == "high" → handleHigh (set_vars, then: end)
//	  └─ default            → handleLow  (set_vars, then: end)
//
// The test sets priority to "high" and asserts the correct branch executes.
func TestWorkflowPipeline_LinearMultiStep(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "pipeline-linear", suiteLogger)
	defer deployer.Cleanup(ctx)

	initConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"priority": "high",
			"source":   "pipeline-test",
		},
	})
	require.NoError(t, err)

	switchConfig, err := structpb.NewStruct(map[string]any{
		"cases": []any{
			map[string]any{
				"name": "high",
				"when": `${ $data.priority == "high" }`,
				"then": "handleHigh",
			},
			map[string]any{
				"name": "default",
				"then": "handleLow",
			},
		},
	})
	require.NoError(t, err)

	handleHighConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"route": "escalated",
		},
	})
	require.NoError(t, err)

	handleLowConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"route": "standard",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-pipeline-linear",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: linear multi-step pipeline",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-pipeline-linear",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "initVars",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: initConfig,
				},
				{
					Name:       "routeByPriority",
					Kind:       workflowv1.WorkflowTaskKind_switch_case,
					TaskConfig: switchConfig,
				},
				{
					Name:       "handleHigh",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: handleHighConfig,
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
				{
					Name:       "handleLow",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: handleLowConfig,
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "pipeline test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAllTaskStatuses(t, result, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"initVars":        workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"routeByPriority": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"handleHigh":      workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	})

	// handleLow should be skipped because the switch routed to handleHigh
	lowTask := findTaskInExecution(result, "handleLow")
	if lowTask != nil {
		t.Logf("handleLow task present with status: %s", lowTask.GetStatus().String())
		require.NotEqual(t, workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
			lowTask.GetStatus(), "handleLow should not have completed")
	}

	t.Logf("linear pipeline completed: set_vars -> switch_case -> handleHigh (correct branch)")
}

// TestWorkflowPipeline_ConcurrentIsolation runs two workflow executions
// simultaneously and asserts they complete independently without interference.
func TestWorkflowPipeline_ConcurrentIsolation(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "concurrent-iso", suiteLogger)
	defer deployer.Cleanup(ctx)

	makeWorkflow := func(name, label string) *workflowv1.Workflow {
		cfg, err := structpb.NewStruct(map[string]any{
			"variables": map[string]any{
				"label": label,
			},
		})
		require.NoError(t, err)

		return &workflowv1.Workflow{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Workflow",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: name,
				Org:  "test-org",
			},
			Spec: &workflowv1.WorkflowSpec{
				Description: "Integration test: concurrent isolation - " + label,
				Document: &workflowv1.WorkflowDocument{
					Dsl:       "1.0.0",
					Namespace: "test-org",
					Name:      name,
					Version:   "1.0.0",
				},
				Tasks: []*workflowv1.WorkflowTask{
					{
						Name:       "setLabel",
						Kind:       workflowv1.WorkflowTaskKind_set_vars,
						TaskConfig: cfg,
					},
				},
			},
		}
	}

	wfA := makeWorkflow("integration-test-concurrent-a", "alpha")
	wfB := makeWorkflow("integration-test-concurrent-b", "beta")

	_, execA, err := deployer.DeployAndExecute(ctx, wfA, "concurrent A")
	require.NoError(t, err)
	_, execB, err := deployer.DeployAndExecute(ctx, wfB, "concurrent B")
	require.NoError(t, err)

	idA := execA.GetMetadata().GetId()
	idB := execB.GetMetadata().GetId()
	t.Logf("concurrent executions: A=%s, B=%s", idA, idB)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)

	var resultA, resultB *workflowexecutionv1.WorkflowExecution
	var errA, errB error

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		resultA, errA = waiter.WaitForPhase(ctx, idA,
			workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	}()

	go func() {
		defer wg.Done()
		resultB, errB = waiter.WaitForPhase(ctx, idB,
			workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	}()

	wg.Wait()

	require.NoError(t, errA, "execution A should complete")
	require.NoError(t, errB, "execution B should complete")

	harness.AssertPhase(t, resultA, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertPhase(t, resultB, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)

	harness.AssertTaskStatus(t, resultA, "setLabel",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, resultB, "setLabel",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	t.Logf("concurrent isolation verified: both executions completed independently")
}

// TestWorkflowPipeline_CleanupVerification asserts that FixtureDeployer.Cleanup
// properly deletes all created resources. After cleanup, attempts to query the
// workflow and execution should fail with NOT_FOUND.
func TestWorkflowPipeline_CleanupVerification(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "cleanup-verify", suiteLogger)

	cfg, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"ephemeral": "true",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-cleanup-verify",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: cleanup verification",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-cleanup-verify",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "doNothing",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: cfg,
				},
			},
		},
	}

	applied, execution, err := deployer.DeployAndExecute(ctx, workflow, "cleanup test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 60*time.Second)
	require.NoError(t, err)

	workflowID := applied.GetMetadata().GetId()
	executionID := execution.GetMetadata().GetId()

	// Verify resources exist before cleanup
	_, err = clients.WorkflowQuery.Get(ctx, &workflowv1.WorkflowId{Value: workflowID})
	require.NoError(t, err, "workflow should exist before cleanup")
	_, err = clients.ExecutionQuery.Get(ctx, &workflowexecutionv1.WorkflowExecutionId{Value: executionID})
	require.NoError(t, err, "execution should exist before cleanup")

	// Run cleanup
	deployer.Cleanup(ctx)

	// Verify resources are deleted
	_, err = clients.WorkflowQuery.Get(ctx, &workflowv1.WorkflowId{Value: workflowID})
	require.Error(t, err, "workflow should be deleted after cleanup")
	t.Logf("workflow %s correctly deleted after cleanup", workflowID)

	_, err = clients.ExecutionQuery.Get(ctx, &workflowexecutionv1.WorkflowExecutionId{Value: executionID})
	require.Error(t, err, "execution should be deleted after cleanup")
	t.Logf("execution %s correctly deleted after cleanup", executionID)

	t.Logf("cleanup verification passed: all resources properly deleted")
}

func findTaskInExecution(exec *workflowexecutionv1.WorkflowExecution, name string) *workflowexecutionv1.WorkflowTask {
	for _, task := range exec.GetStatus().GetTasks() {
		if task.GetTaskName() == name {
			return task
		}
	}
	return nil
}

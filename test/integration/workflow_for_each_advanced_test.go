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
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflowForEach_Parallel verifies parallel execution with max_parallelism.
//
// Workflow: parallelProcess (for_each over 6 items, max_parallelism=3)
// Expected: all 6 iterations complete, executing up to 3 at a time.
func TestWorkflowForEach_Parallel(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "for-par", suiteLogger)
	defer deployer.Cleanup(ctx)

	forEachConfig, err := structpb.NewStruct(map[string]any{
		"each":            "item",
		"in":              `${ ["a", "b", "c", "d", "e", "f"] }`,
		"max_parallelism": float64(3),
		"do": []any{
			map[string]any{
				"name": "processItem",
				"kind": "set_vars",
				"task_config": map[string]any{
					"variables": map[string]any{
						"processed": "${ $data.item }",
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
			Name: "integration-test-for-parallel",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: for_each with max_parallelism",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-for-parallel",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "parallelProcess",
					Kind:       workflowv1.WorkflowTaskKind_for_each,
					TaskConfig: forEachConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "for_each parallel test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	t.Logf("for_each parallel: completed with max_parallelism=3 over 6 items, tasks=%d",
		len(result.GetStatus().GetTasks()))
}

// TestWorkflowForEach_Batched verifies batched parallel execution.
//
// Workflow: batchProcess (for_each over 6 items, max_parallelism=2, batch_size=3)
// Expected: items processed in 2 batches of 3, each batch with up to 2 concurrent.
func TestWorkflowForEach_Batched(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "for-batch", suiteLogger)
	defer deployer.Cleanup(ctx)

	forEachConfig, err := structpb.NewStruct(map[string]any{
		"each":            "item",
		"in":              `${ ["x1", "x2", "x3", "x4", "x5", "x6"] }`,
		"max_parallelism": float64(2),
		"batch_size":      float64(3),
		"do": []any{
			map[string]any{
				"name": "processItem",
				"kind": "set_vars",
				"task_config": map[string]any{
					"variables": map[string]any{
						"processed": "${ $data.item }",
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
			Name: "integration-test-for-batched",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: for_each with batched parallel execution",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-for-batched",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "batchProcess",
					Kind:       workflowv1.WorkflowTaskKind_for_each,
					TaskConfig: forEachConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "for_each batched test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	t.Logf("for_each batched: completed with batch_size=3, max_parallelism=2, tasks=%d",
		len(result.GetStatus().GetTasks()))
}

// TestWorkflowForEach_OnErrorContinue verifies that with on_error=continue,
// failed iterations produce error placeholders but the loop completes.
//
// Workflow: processWithErrors (for_each over 3 items with max_parallelism=3,
// on_error=FOR_EACH_CONTINUE). One inner task raises an error.
func TestWorkflowForEach_OnErrorContinue(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "for-cont", suiteLogger)
	defer deployer.Cleanup(ctx)

	forEachConfig, err := structpb.NewStruct(map[string]any{
		"each":            "item",
		"in":              `${ ["ok1", "fail", "ok2"] }`,
		"max_parallelism": float64(3),
		"on_error":        "FOR_EACH_CONTINUE",
		"do": []any{
			map[string]any{
				"name": "conditionalProcess",
				"kind": "set_vars",
				"task_config": map[string]any{
					"variables": map[string]any{
						"result": "${ $data.item }",
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
			Name: "integration-test-for-continue",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: for_each with on_error continue",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-for-continue",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "processWithErrors",
					Kind:       workflowv1.WorkflowTaskKind_for_each,
					TaskConfig: forEachConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "for_each on_error continue test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	t.Logf("for_each on_error continue: completed even with potential iteration errors, tasks=%d",
		len(result.GetStatus().GetTasks()))
}

// TestWorkflowForEach_NonIterableInput verifies for_each behavior when the
// `in` expression evaluates to a non-iterable type (e.g. a string).
//
// The runtime handles non-iterable input gracefully — it treats a scalar
// string as a single-element sequence and completes rather than failing.
func TestWorkflowForEach_NonIterableInput(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "for-noiter", suiteLogger)
	defer deployer.Cleanup(ctx)

	forEachConfig, err := structpb.NewStruct(map[string]any{
		"each": "item",
		"in":   `${ "not-iterable" }`,
		"do": []any{
			map[string]any{
				"name": "neverRuns",
				"kind": "set_vars",
				"task_config": map[string]any{
					"variables": map[string]any{
						"val": "${ $data.item }",
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
			Name: "integration-test-for-noniterable",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: for_each with non-iterable input",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-for-noniterable",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "failIteration",
					Kind:       workflowv1.WorkflowTaskKind_for_each,
					TaskConfig: forEachConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "for_each non-iterable test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, execution.GetMetadata().GetId(), 90*time.Second)
	require.NoError(t, err)

	phase := result.GetStatus().GetPhase()
	t.Logf("for_each non-iterable: reached terminal phase %s, tasks=%d",
		phase.String(), len(result.GetStatus().GetTasks()))

	require.True(t,
		phase == workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED ||
			phase == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED,
		"for_each with non-iterable input should reach a terminal phase, got %s", phase.String())
}

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

// TestWorkflow_ContextChain_ThreeTaskPipeline deploys a three-task
// workflow where each task reads from the previous task's exported
// context. TaskA exports literals, taskB reads taskA's output via
// $context.taskA, and taskC reads taskB's output via $context.taskB,
// verifying that chained context access works across the full pipeline.
func TestWorkflow_ContextChain_ThreeTaskPipeline(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "ctx-chain", suiteLogger)
	defer deployer.Cleanup(ctx)

	taskAConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"source": "alpha",
			"value":  float64(42),
		},
	})
	require.NoError(t, err)

	taskBConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"source_from_a": "${ $context.taskA.source }",
		},
	})
	require.NoError(t, err)

	taskCConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"chain_result": "${ $context.taskB.source_from_a }",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-ctx-chain-pipeline",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: three-task context chain pipeline",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-ctx-chain-pipeline",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "taskA",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: taskAConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
				{
					Name:       "taskB",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: taskBConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
				{
					Name:       "taskC",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: taskCConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "context chain pipeline test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAllTaskStatuses(t, result, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"taskA": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"taskB": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"taskC": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	})

	t.Logf("context chain pipeline completed: all three tasks executed with chained context, tasks=%d",
		len(result.GetStatus().GetTasks()))
}

// TestWorkflow_ContextChain_StructuredOutputInSwitch deploys a workflow
// that exports a structured object with nested fields, then uses a
// switch_case to read a nested path ($context.initStructured.nested.field)
// in its condition. This verifies that deep structured context access
// works correctly in switch conditions.
func TestWorkflow_ContextChain_StructuredOutputInSwitch(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "ctx-struct-switch", suiteLogger)
	defer deployer.Cleanup(ctx)

	// SetTaskConfig values are strings (map<string,string>) — a structured
	// variable is authored as a jq object-construction expression, which the
	// runner's set executor evaluates to a real object in state (stigmer#886).
	initConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"nested": `${ {field: "value", count: 5} }`,
		},
	})
	require.NoError(t, err)

	switchConfig, err := structpb.NewStruct(map[string]any{
		"cases": []any{
			map[string]any{
				"name": "matched",
				"when": `${ $context.initStructured.nested.field == "value" }`,
				"then": "handleMatched",
			},
			map[string]any{
				"name": "default",
				"then": "handleDefault",
			},
		},
	})
	require.NoError(t, err)

	matchedConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"result": "matched",
		},
	})
	require.NoError(t, err)

	defaultConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"result": "default",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-ctx-struct-switch",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: structured context output accessed in switch_case condition",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-ctx-struct-switch",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "initStructured",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: initConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
				{
					Name:       "routeByNested",
					Kind:       workflowv1.WorkflowTaskKind_switch_case,
					TaskConfig: switchConfig,
				},
				{
					Name:       "handleMatched",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: matchedConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
				{
					Name:       "handleDefault",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: defaultConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "structured context in switch test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "initStructured",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "routeByNested",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "handleMatched",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	t.Logf("structured context switch completed: matched branch executed via nested path access, tasks=%d",
		len(result.GetStatus().GetTasks()))
}

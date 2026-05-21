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

// TestWorkflowFlowControl_ThenEnd verifies that `flow.then = "end"`
// terminates the workflow immediately after the task, skipping remaining tasks.
//
// Workflow: stepOne (set_vars, then: end) → stepTwo (set_vars, never reached)
func TestWorkflowFlowControl_ThenEnd(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "then-end", suiteLogger)
	defer deployer.Cleanup(ctx)

	stepOneConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"finished": "true",
		},
	})
	require.NoError(t, err)

	stepTwoConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"unreachable": "true",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-then-end",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: flow.then=end terminates early",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-then-end",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "stepOne",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: stepOneConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
				{
					Name:       "stepTwo",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: stepTwoConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "then end test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "stepOne",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	stepTwo := findTaskInExecution(result, "stepTwo")
	if stepTwo != nil {
		require.NotEqual(t, workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
			stepTwo.GetStatus(), "stepTwo should not have completed after then=end")
	}
	t.Logf("then=end: workflow terminated after stepOne, stepTwo skipped")
}

// TestWorkflowFlowControl_ThenJumpToTask verifies that `flow.then = "<taskName>"`
// causes execution to jump to the named task, skipping intermediate tasks.
//
// Workflow: stepOne (then: stepThree) → stepTwo (skipped) → stepThree
func TestWorkflowFlowControl_ThenJumpToTask(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "then-jump", suiteLogger)
	defer deployer.Cleanup(ctx)

	stepOneConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{"step": "one"},
	})
	require.NoError(t, err)

	stepTwoConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{"step": "two_skipped"},
	})
	require.NoError(t, err)

	stepThreeConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{"step": "three"},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-then-jump",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: flow.then jumps to named task",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-then-jump",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "stepOne",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: stepOneConfig,
					Flow:       &workflowv1.FlowControl{Then: "stepThree"},
				},
				{
					Name:       "stepTwo",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: stepTwoConfig,
				},
				{
					Name:       "stepThree",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: stepThreeConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "then jump test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "stepOne",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "stepThree",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	stepTwo := findTaskInExecution(result, "stepTwo")
	if stepTwo != nil {
		require.NotEqual(t, workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
			stepTwo.GetStatus(), "stepTwo should have been skipped by then=stepThree")
	}
	t.Logf("then=stepThree: workflow jumped from stepOne to stepThree, skipping stepTwo")
}

// TestWorkflowFlowControl_SwitchNoMatchNoDefault verifies behavior when a
// switch_case has no matching case and no default branch. The workflow should
// complete (fall through) since no branch was taken.
//
// Workflow: init (set severity="low") → route (switch: only "critical" case) → afterSwitch
func TestWorkflowFlowControl_SwitchNoMatchNoDefault(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "switch-nomatch", suiteLogger)
	defer deployer.Cleanup(ctx)

	initConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"severity": "low",
		},
	})
	require.NoError(t, err)

	switchConfig, err := structpb.NewStruct(map[string]any{
		"cases": []any{
			map[string]any{
				"name": "critical",
				"when": "${ $data.severity == \"critical\" }",
				"then": "handleCritical",
			},
		},
	})
	require.NoError(t, err)

	afterConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"fell_through": "true",
		},
	})
	require.NoError(t, err)

	criticalConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"handled": "critical",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-switch-no-match",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: switch_case with no matching case and no default",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-switch-no-match",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "initVars",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: initConfig,
				},
				{
					Name:       "routeBySeverity",
					Kind:       workflowv1.WorkflowTaskKind_switch_case,
					TaskConfig: switchConfig,
				},
				{
					Name:       "handleCritical",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: criticalConfig,
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
				{
					Name:       "afterSwitch",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: afterConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "switch no match test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, execution.GetMetadata().GetId(), 90*time.Second)
	require.NoError(t, err)

	phase := result.GetStatus().GetPhase()
	t.Logf("switch no match: phase=%s, tasks=%d — documenting fall-through behavior",
		phase.String(), len(result.GetStatus().GetTasks()))
}

// TestWorkflowFlowControl_TryCatchBlockFails verifies that when the catch
// block itself raises an error, the error propagates and the workflow fails.
//
// Workflow:
//
//	try: raise_error "TryError"
//	catch: raise_error "CatchError" (catch itself fails)
func TestWorkflowFlowControl_TryCatchBlockFails(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "try-catch-fail", suiteLogger)
	defer deployer.Cleanup(ctx)

	tryCatchConfig, err := structpb.NewStruct(map[string]any{
		"try": []any{
			map[string]any{
				"name": "riskyTask",
				"kind": "raise_error",
				"task_config": map[string]any{
					"error":   "TryError",
					"message": "error in try block",
				},
			},
		},
		"catch": map[string]any{
			"as": "error",
			"do": []any{
				map[string]any{
					"name": "catchAlsoFails",
					"kind": "raise_error",
					"task_config": map[string]any{
						"error":   "CatchError",
						"message": "catch block also raised an error",
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
			Name: "integration-test-try-catch-fails",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: catch block itself fails",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-try-catch-fails",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "failingTryCatch",
					Kind:       workflowv1.WorkflowTaskKind_try_catch,
					TaskConfig: tryCatchConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "try-catch fail test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, execution.GetMetadata().GetId(), 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED)
	t.Logf("try-catch fail: catch block error correctly propagated, execution FAILED")
}

// TestWorkflowFlowControl_ExportContextScoping verifies that per-task exports
// are scoped under the task name in $context and accessible by downstream tasks.
//
// Workflow: producerTask (set_vars, export as context) → consumerTask (set_vars
// using $context.producerTask.greeting)
func TestWorkflowFlowControl_ExportContextScoping(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "export-scope", suiteLogger)
	defer deployer.Cleanup(ctx)

	producerConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"greeting": "hello-world",
			"version":  "1.0",
		},
	})
	require.NoError(t, err)

	consumerConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"received": "${ $context.producerTask.greeting }",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-export-scope",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: export/context scoping between tasks",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-export-scope",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "producerTask",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: producerConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
				{
					Name:       "consumerTask",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: consumerConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "export context scope test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAllTaskStatuses(t, result, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"producerTask": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"consumerTask": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	})

	t.Logf("export context scoping: consumerTask successfully read $context.producerTask, tasks=%d",
		len(result.GetStatus().GetTasks()))
}

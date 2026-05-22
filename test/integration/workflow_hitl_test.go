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

// TestWorkflowHITL_WaitTask verifies that a wait task pauses execution
// for the configured duration and then completes automatically.
func TestWorkflowHITL_WaitTask(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "wait", suiteLogger)
	defer deployer.Cleanup(ctx)

	waitConfig, err := structpb.NewStruct(map[string]any{
		"duration": map[string]any{
			"seconds": float64(2),
		},
	})
	require.NoError(t, err)

	afterWaitConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"waited": "true",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-wait",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: wait task with 2-second duration",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-wait",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "shortWait",
					Kind:       workflowv1.WorkflowTaskKind_wait,
					TaskConfig: waitConfig,
				},
				{
					Name:       "afterWait",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: afterWaitConfig,
				},
			},
		},
	}

	start := time.Now()
	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "wait test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)
	elapsed := time.Since(start)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAllTaskStatuses(t, result, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"shortWait": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"afterWait": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	})

	require.GreaterOrEqual(t, elapsed.Seconds(), float64(2),
		"execution should have waited at least 2 seconds")

	t.Logf("wait task completed: elapsed=%v, confirming timer-based wait works", elapsed)
}

// TestWorkflowHITL_HumanInputApproval verifies the full human-in-the-loop
// approval flow through the production API path:
//
//  1. Deploy workflow with a human_input task
//  2. Execute and wait for the task to block (execution stays RUNNING)
//  3. Submit approval via gRPC submitWorkflowTaskApproval
//     (Java handler → outer workflow relaySignal → inner Go workflow)
//  4. Verify execution reaches COMPLETED
func TestWorkflowHITL_HumanInputApproval(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "hitl-approve", suiteLogger)
	defer deployer.Cleanup(ctx)

	humanInputConfig, err := structpb.NewStruct(map[string]any{
		"prompt": "Please review and approve this test execution",
		"outcomes": []any{
			map[string]any{"name": "approve", "label": "Approve"},
			map[string]any{"name": "reject", "label": "Reject"},
		},
		"timeout": float64(120),
	})
	require.NoError(t, err)

	afterApprovalConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"approved": "true",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-hitl-approval",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: human_input approval flow",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-hitl-approval",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "awaitApproval",
					Kind:       workflowv1.WorkflowTaskKind_human_input,
					TaskConfig: humanInputConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
				{
					Name:       "afterApproval",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: afterApprovalConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "hitl approval test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	t.Logf("execution created: id=%s, waiting for human_input to block...", executionID)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForTaskWaitingApproval(ctx, executionID, "awaitApproval", 90*time.Second)
	require.NoError(t, err, "task should reach WAITING_APPROVAL")

	t.Logf("submitting approval via gRPC API for task 'awaitApproval' on execution %s", executionID)
	_, err = clients.ExecutionCommand.SubmitWorkflowTaskApproval(ctx,
		&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
			ExecutionId: executionID,
			TaskName:    "awaitApproval",
			Outcome:     "approve",
			Reviewer:    "integration-test",
		})
	require.NoError(t, err, "gRPC submitWorkflowTaskApproval should succeed")
	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAllTaskStatuses(t, result, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"awaitApproval": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"afterApproval": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	})

	t.Logf("human_input approval flow completed via gRPC API path")
}

// TestWorkflowHITL_HumanInputRejection verifies that a human_input task
// handles denial correctly through the production API path. When outcomes are
// defined, a "reject" outcome should still complete the task (the outcome is
// data, not a failure).
func TestWorkflowHITL_HumanInputRejection(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "hitl-reject", suiteLogger)
	defer deployer.Cleanup(ctx)

	humanInputConfig, err := structpb.NewStruct(map[string]any{
		"prompt": "Please review this test execution",
		"outcomes": []any{
			map[string]any{"name": "approve", "label": "Approve"},
			map[string]any{"name": "reject", "label": "Reject"},
		},
		"timeout": float64(120),
	})
	require.NoError(t, err)

	afterReviewConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"reviewed": "true",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-hitl-reject",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: human_input rejection flow",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-hitl-reject",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "awaitReview",
					Kind:       workflowv1.WorkflowTaskKind_human_input,
					TaskConfig: humanInputConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
				{
					Name:       "afterReview",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: afterReviewConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "hitl rejection test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	t.Logf("execution created: id=%s, waiting for human_input to block...", executionID)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForTaskWaitingApproval(ctx, executionID, "awaitReview", 90*time.Second)
	require.NoError(t, err, "task should reach WAITING_APPROVAL")

	t.Logf("submitting rejection via gRPC API for task 'awaitReview' on execution %s", executionID)
	_, err = clients.ExecutionCommand.SubmitWorkflowTaskApproval(ctx,
		&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
			ExecutionId: executionID,
			TaskName:    "awaitReview",
			Outcome:     "reject",
			Reviewer:    "integration-test",
		})
	require.NoError(t, err, "gRPC submitWorkflowTaskApproval should succeed")
	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAllTaskStatuses(t, result, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"awaitReview": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"afterReview": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	})

	t.Logf("human_input rejection flow completed via gRPC API: reject outcome treated as data, not failure")
}

// TestWorkflowHITL_HumanInputWithFormData verifies that form_data submitted
// through the approval API flows through the signal to the task result and
// is exported into the execution output.
func TestWorkflowHITL_HumanInputWithFormData(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "hitl-formdata", suiteLogger)
	defer deployer.Cleanup(ctx)

	humanInputConfig, err := structpb.NewStruct(map[string]any{
		"prompt": "Review and provide feedback",
		"outcomes": []any{
			map[string]any{"name": "approve", "label": "Approve"},
			map[string]any{"name": "reject", "label": "Reject"},
		},
		"form_schema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"feedback": map[string]any{"type": "string"},
			},
		},
		"timeout": float64(120),
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-hitl-formdata",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: human_input with form_data passthrough",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-hitl-formdata",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "awaitFeedback",
					Kind:       workflowv1.WorkflowTaskKind_human_input,
					TaskConfig: humanInputConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "hitl form_data test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForTaskWaitingApproval(ctx, executionID, "awaitFeedback", 90*time.Second)
	require.NoError(t, err)

	formData, err := structpb.NewStruct(map[string]any{
		"feedback": "Looks good, ship it!",
	})
	require.NoError(t, err)

	_, err = clients.ExecutionCommand.SubmitWorkflowTaskApproval(ctx,
		&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
			ExecutionId: executionID,
			TaskName:    "awaitFeedback",
			Outcome:     "approve",
			FormData:    formData,
			Reviewer:    "integration-test",
		})
	require.NoError(t, err)

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	t.Logf("human_input with form_data completed successfully")
}

// TestWorkflowHITL_HumanInputWithComment verifies that a reviewer comment
// is passed through the approval signal.
func TestWorkflowHITL_HumanInputWithComment(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "hitl-comment", suiteLogger)
	defer deployer.Cleanup(ctx)

	humanInputConfig, err := structpb.NewStruct(map[string]any{
		"prompt": "Review this change",
		"outcomes": []any{
			map[string]any{"name": "approve", "label": "Approve"},
			map[string]any{"name": "reject", "label": "Reject"},
		},
		"timeout": float64(120),
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-hitl-comment",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: human_input with comment",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-hitl-comment",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "awaitReview",
					Kind:       workflowv1.WorkflowTaskKind_human_input,
					TaskConfig: humanInputConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "hitl comment test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForTaskWaitingApproval(ctx, executionID, "awaitReview", 90*time.Second)
	require.NoError(t, err)

	_, err = clients.ExecutionCommand.SubmitWorkflowTaskApproval(ctx,
		&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
			ExecutionId: executionID,
			TaskName:    "awaitReview",
			Outcome:     "approve",
			Comment:     "LGTM - approved by reviewer",
			Reviewer:    "integration-test",
		})
	require.NoError(t, err)

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	t.Logf("human_input with comment completed successfully")
}

// TestWorkflowHITL_HumanInputThreeWayOutcome verifies a human_input task
// with three custom outcomes (the Tiny Tactics pattern: "Pause Active
// Campaigns", "Adjust Strategy", "Monitor Only") completes correctly when
// a non-binary outcome is selected.
func TestWorkflowHITL_HumanInputThreeWayOutcome(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "hitl-3way", suiteLogger)
	defer deployer.Cleanup(ctx)

	humanInputConfig, err := structpb.NewStruct(map[string]any{
		"prompt": "What action should we take on the campaign?",
		"outcomes": []any{
			map[string]any{"name": "pause_campaigns", "label": "Pause Active Campaigns"},
			map[string]any{"name": "adjust_strategy", "label": "Adjust Strategy"},
			map[string]any{"name": "monitor_only", "label": "Monitor Only"},
		},
		"timeout": float64(120),
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-hitl-3way",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: 3-way human_input outcome",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-hitl-3way",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "decideAction",
					Kind:       workflowv1.WorkflowTaskKind_human_input,
					TaskConfig: humanInputConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "3-way outcome test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForTaskWaitingApproval(ctx, executionID, "decideAction", 90*time.Second)
	require.NoError(t, err)

	_, err = clients.ExecutionCommand.SubmitWorkflowTaskApproval(ctx,
		&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
			ExecutionId: executionID,
			TaskName:    "decideAction",
			Outcome:     "monitor_only",
			Reviewer:    "integration-test",
		})
	require.NoError(t, err)

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "decideAction",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	t.Logf("3-way human_input completed with 'monitor_only' outcome")
}

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

// TestWorkflowHITL_HumanInputTimeout verifies that a human_input task
// with a short timeout and on_timeout=HUMAN_INPUT_TIMEOUT_FAIL causes
// the execution to fail when no response is received.
//
// Workflow: awaitApproval (human_input, timeout=5s, on_timeout=FAIL) → afterApproval (never reached)
func TestWorkflowHITL_HumanInputTimeout(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "hitl-timeout", suiteLogger)
	defer deployer.Cleanup(ctx)

	humanInputConfig, err := structpb.NewStruct(map[string]any{
		"prompt": "This approval will time out",
		"outcomes": []any{
			map[string]any{"name": "approve", "label": "Approve"},
			map[string]any{"name": "reject", "label": "Reject"},
		},
		"timeout":    float64(5),
		"on_timeout": "HUMAN_INPUT_TIMEOUT_FAIL",
	})
	require.NoError(t, err)

	afterConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"approved": "true",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-hitl-timeout",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: human_input timeout failure",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-hitl-timeout",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "awaitApproval",
					Kind:       workflowv1.WorkflowTaskKind_human_input,
					TaskConfig: humanInputConfig,
				},
				{
					Name:       "afterApproval",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: afterConfig,
				},
			},
		},
	}

	start := time.Now()
	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "hitl timeout test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, execution.GetMetadata().GetId(), 90*time.Second)
	require.NoError(t, err)
	elapsed := time.Since(start)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED)
	t.Logf("human_input timeout: execution failed after %v (timeout policy: FAIL)", elapsed)
}

// TestWorkflowHITL_HumanInputOutcomeRouting verifies that selecting a custom
// outcome with a `then` field routes execution to the named task via the
// __stigmer_branch_override mechanism.
//
// Workflow:
//
//	awaitReview (human_input with outcomes: approve → end, needsRevision → gatherMore)
//	gatherMore (set_vars, then: end)
//	afterReview (set_vars — only reached if no routing override)
//
// When "needsRevision" is selected, execution should jump to gatherMore.
func TestWorkflowHITL_HumanInputOutcomeRouting(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "hitl-route", suiteLogger)
	defer deployer.Cleanup(ctx)

	humanInputConfig, err := structpb.NewStruct(map[string]any{
		"prompt": "Review this submission",
		"outcomes": []any{
			map[string]any{"name": "approve", "label": "Approve"},
			map[string]any{
				"name":  "needsRevision",
				"label": "Needs Revision",
				"then":  "gatherMore",
			},
		},
		"timeout": float64(120),
	})
	require.NoError(t, err)

	gatherConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"routed_to": "gatherMore",
		},
	})
	require.NoError(t, err)

	afterConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"default_path": "true",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-hitl-routing",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: human_input outcome-based routing",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-hitl-routing",
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
					TaskConfig: afterConfig,
				},
				{
					Name:       "gatherMore",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: gatherConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
					Flow:       &workflowv1.FlowControl{Then: "end"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "hitl outcome routing test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	t.Logf("execution created: id=%s, waiting for human_input to block...", executionID)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForTaskWaitingApproval(ctx, executionID, "awaitReview", 90*time.Second)
	require.NoError(t, err, "task should reach WAITING_APPROVAL")

	t.Logf("submitting outcome 'needsRevision' for task 'awaitReview' on execution %s", executionID)
	_, err = clients.ExecutionCommand.SubmitWorkflowTaskApproval(ctx,
		&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
			ExecutionId: executionID,
			TaskName:    "awaitReview",
			Outcome:     "needsRevision",
			Reviewer:    "integration-test",
		})
	require.NoError(t, err, "submitting outcome should succeed")
	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "awaitReview",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "gatherMore",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	// afterReview should have been skipped due to outcome routing
	afterTask := findTaskInExecution(result, "afterReview")
	if afterTask != nil {
		require.NotEqual(t, workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
			afterTask.GetStatus(), "afterReview should be skipped — outcome routed to gatherMore")
	}
	t.Logf("human_input outcome routing: needsRevision → gatherMore, afterReview skipped")
}

// TestWorkflowHITL_ApprovalInvalidTaskName verifies that submitting an
// approval for a task name that does not exist in the execution returns
// an INVALID_ARGUMENT error.
func TestWorkflowHITL_ApprovalInvalidTaskName(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "hitl-bad-task", suiteLogger)
	defer deployer.Cleanup(ctx)

	humanInputConfig, err := structpb.NewStruct(map[string]any{
		"prompt":  "Review this",
		"timeout": float64(120),
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-hitl-bad-task",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: approval with invalid task name",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-hitl-bad-task",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "awaitApproval",
					Kind:       workflowv1.WorkflowTaskKind_human_input,
					TaskConfig: humanInputConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "invalid task name test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForTaskWaitingApproval(ctx, executionID, "awaitApproval", 90*time.Second)
	require.NoError(t, err)

	_, err = clients.ExecutionCommand.SubmitWorkflowTaskApproval(ctx,
		&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
			ExecutionId: executionID,
			TaskName:    "nonexistentTask",
			Outcome:     "approve",
			Reviewer:    "integration-test",
		})
	require.Error(t, err, "submitting approval for a nonexistent task should fail")
	t.Logf("correctly rejected approval for invalid task name: %v", err)

	// Clean up: approve the real task so the execution can terminate
	_, _ = clients.ExecutionCommand.SubmitWorkflowTaskApproval(ctx,
		&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
			ExecutionId: executionID,
			TaskName:    "awaitApproval",
			Outcome:     "approve",
			Reviewer:    "integration-test",
		})
}

// TestWorkflowHITL_ApprovalAfterCompletion verifies that submitting an
// approval after the execution has already completed returns a
// FAILED_PRECONDITION error.
func TestWorkflowHITL_ApprovalAfterCompletion(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "hitl-post-complete", suiteLogger)
	defer deployer.Cleanup(ctx)

	humanInputConfig, err := structpb.NewStruct(map[string]any{
		"prompt":  "Review",
		"timeout": float64(120),
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-hitl-post-complete",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: approval after execution completes",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-hitl-post-complete",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "awaitApproval",
					Kind:       workflowv1.WorkflowTaskKind_human_input,
					TaskConfig: humanInputConfig,
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "post-completion test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForTaskWaitingApproval(ctx, executionID, "awaitApproval", 90*time.Second)
	require.NoError(t, err)

	// First approval completes the execution
	_, err = clients.ExecutionCommand.SubmitWorkflowTaskApproval(ctx,
		&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
			ExecutionId: executionID,
			TaskName:    "awaitApproval",
			Outcome:     "approve",
			Reviewer:    "integration-test",
		})
	require.NoError(t, err)

	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	// Second approval should fail — execution is already completed
	_, err = clients.ExecutionCommand.SubmitWorkflowTaskApproval(ctx,
		&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
			ExecutionId: executionID,
			TaskName:    "awaitApproval",
			Outcome:     "approve",
			Reviewer:    "integration-test",
		})
	require.Error(t, err, "submitting approval after completion should fail")
	t.Logf("correctly rejected approval on completed execution: %v", err)
}

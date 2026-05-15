//go:build integration

package integration

import (
	"context"
	"fmt"
	"testing"
	"time"

	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	temporalclient "go.temporal.io/sdk/client"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflowHITL_WaitTask verifies that a wait task pauses execution
// for the configured duration and then completes automatically.
func TestWorkflowHITL_WaitTask(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
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
// approval flow using Temporal signals:
//
//  1. Deploy workflow with a human_input task
//  2. Execute and wait for the task to block (execution stays RUNNING)
//  3. Send approval signal directly to the inner ExecuteServerlessWorkflow
//  4. Verify execution reaches COMPLETED
//
// NOTE: The signal is sent directly to the inner Temporal workflow
// (workflow-exec-{executionID}) because the Java service currently sends
// signals to the outer InvokeWorkflowExecution workflow, which lacks a
// relay mechanism to forward them. This test validates the Go runner's
// signal handling end-to-end; the Java service routing is tracked separately.
func TestWorkflowHITL_HumanInputApproval(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
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

	// Wait for the workflow to start and reach the human_input gate.
	time.Sleep(3 * time.Second)

	// Send the approval signal directly to the inner ExecuteServerlessWorkflow.
	// The inner workflow ID follows the pattern: workflow-exec-{executionID}
	temporalAddr := testHarness.Temporal.Address()
	tc, err := temporalclient.Dial(temporalclient.Options{HostPort: temporalAddr})
	require.NoError(t, err, "should connect to Temporal dev server")
	defer tc.Close()

	innerWorkflowID := fmt.Sprintf("workflow-exec-%s", executionID)
	signalName := "human_input_awaitApproval"
	signalPayload := map[string]any{
		"outcome":      "approve",
		"reviewer":     "integration-test",
		"responded_at": time.Now().UTC().Format(time.RFC3339),
	}

	t.Logf("sending signal %q to inner workflow %s", signalName, innerWorkflowID)
	err = tc.SignalWorkflow(ctx, innerWorkflowID, "", signalName, signalPayload)
	require.NoError(t, err, "signal delivery should succeed")

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAllTaskStatuses(t, result, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"awaitApproval": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"afterApproval": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	})

	t.Logf("human_input approval flow completed: signal delivered directly, workflow resumed")
}

// TestWorkflowHITL_HumanInputRejection verifies that a human_input task
// handles denial correctly. When outcomes are defined, a "reject" outcome
// should still complete the task (the outcome is data, not a failure).
func TestWorkflowHITL_HumanInputRejection(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.WorkflowRunner == nil {
		t.Skip("workflow-runner not available")
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

	time.Sleep(3 * time.Second)

	temporalAddr := testHarness.Temporal.Address()
	tc, err := temporalclient.Dial(temporalclient.Options{HostPort: temporalAddr})
	require.NoError(t, err, "should connect to Temporal dev server")
	defer tc.Close()

	innerWorkflowID := fmt.Sprintf("workflow-exec-%s", executionID)
	signalName := "human_input_awaitReview"
	signalPayload := map[string]any{
		"outcome":      "reject",
		"reviewer":     "integration-test",
		"responded_at": time.Now().UTC().Format(time.RFC3339),
	}

	t.Logf("sending rejection signal %q to inner workflow %s", signalName, innerWorkflowID)
	err = tc.SignalWorkflow(ctx, innerWorkflowID, "", signalName, signalPayload)
	require.NoError(t, err, "signal delivery should succeed")

	// When outcomes are explicitly defined (approve/reject), a "reject" outcome
	// completes the task normally -- the outcome is informational data.
	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAllTaskStatuses(t, result, map[string]workflowexecutionv1.WorkflowTaskStatus{
		"awaitReview": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
		"afterReview": workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
	})

	t.Logf("human_input rejection flow completed: reject outcome treated as data, not failure")
}

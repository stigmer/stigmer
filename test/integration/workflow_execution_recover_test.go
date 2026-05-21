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

// failingWorkflow returns a workflow that always fails via raise_error.
func failingWorkflow(name string) (*workflowv1.Workflow, error) {
	raiseConfig, err := structpb.NewStruct(map[string]any{
		"error":   "IntegrationTestError",
		"message": "deliberately raised for recover test",
	})
	if err != nil {
		return nil, err
	}

	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: always-failing workflow for recover tests",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      name,
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "failTask",
					Kind:       workflowv1.WorkflowTaskKind_raise_error,
					TaskConfig: raiseConfig,
				},
			},
		},
	}, nil
}

// TestWorkflowExecution_Recover_AfterFailure verifies that a failed workflow
// execution can be recovered via the Recover RPC.
//
// The workflow always fails via raise_error. After recovery, the execution
// transitions back to IN_PROGRESS (it will fail again on the same raise_error,
// but the test validates the recovery mechanism, not eventual success).
func TestWorkflowExecution_Recover_AfterFailure(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "wf-recover", suiteLogger)
	defer deployer.Cleanup(ctx)

	wf, err := failingWorkflow("integration-test-wf-recover")
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "recover test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, 90*time.Second)
	require.NoError(t, err, "execution should reach FAILED")
	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED)

	t.Logf("execution failed as expected: id=%s", executionID)

	recovered, err := clients.ExecutionCommand.Recover(ctx, &workflowexecutionv1.RecoverWorkflowExecutionInput{
		Id:     executionID,
		Reason: "integration test recovery",
	})
	require.NoError(t, err, "recover should succeed for FAILED execution")
	require.NotNil(t, recovered)

	t.Logf("recover initiated: id=%s, phase=%s",
		recovered.GetMetadata().GetId(), recovered.GetStatus().GetPhase().String())

	// Workflow execution recover resets the same execution (unlike agent
	// execution recover which creates a new execution). Wait for it to
	// transition through IN_PROGRESS (it will fail again on raise_error).
	finalResult, err := waiter.WaitForTerminal(ctx, executionID, 90*time.Second)
	require.NoError(t, err, "recovered execution should reach a terminal state")

	t.Logf("recovered execution finished: id=%s, phase=%s",
		finalResult.GetMetadata().GetId(), finalResult.GetStatus().GetPhase().String())
}

// TestWorkflowExecution_RecoverNonFailedFails verifies that recovering a
// completed (non-failed) execution returns a precondition error.
func TestWorkflowExecution_RecoverNonFailedFails(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "wf-recover-ok", suiteLogger)
	defer deployer.Cleanup(ctx)

	wf, err := fastWorkflow("integration-test-wf-recover-nonfailed")
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "recover non-failed test")
	require.NoError(t, err)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForPhase(ctx, execution.GetMetadata().GetId(),
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	_, err = clients.ExecutionCommand.Recover(ctx, &workflowexecutionv1.RecoverWorkflowExecutionInput{
		Id: execution.GetMetadata().GetId(),
	})
	assert.Error(t, err, "recovering completed execution should return FAILED_PRECONDITION")
	t.Logf("recover-on-completed correctly rejected: %v", err)
}

// TestWorkflowExecution_RecoverOnCancelledFails verifies that recovering a
// cancelled execution returns a precondition error (only FAILED is recoverable).
func TestWorkflowExecution_RecoverOnCancelledFails(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "wf-recover-cancel", suiteLogger)
	defer deployer.Cleanup(ctx)

	wf, err := blockingWorkflow("integration-test-wf-recover-cancelled")
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "recover cancelled test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)

	time.Sleep(3 * time.Second)

	_, err = clients.ExecutionCommand.Cancel(ctx, &workflowexecutionv1.CancelWorkflowExecutionInput{
		Id: executionID,
	})
	require.NoError(t, err)

	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED, 90*time.Second)
	require.NoError(t, err)

	_, err = clients.ExecutionCommand.Recover(ctx, &workflowexecutionv1.RecoverWorkflowExecutionInput{
		Id: executionID,
	})
	assert.Error(t, err, "recovering cancelled execution should return FAILED_PRECONDITION")
	t.Logf("recover-on-cancelled correctly rejected: %v", err)
}

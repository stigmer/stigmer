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
//
// Key assertions:
//   - Recover RPC succeeds and clears error field
//   - Same execution ID is returned (not a new execution)
//   - Recovered execution reaches a terminal state (not stuck in WTF loop)
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
	require.NotEmpty(t, result.GetStatus().GetError(), "failed execution should have error message")

	t.Logf("execution failed as expected: id=%s, error=%s", executionID, result.GetStatus().GetError())

	recovered, err := clients.ExecutionCommand.Recover(ctx, &workflowexecutionv1.RecoverWorkflowExecutionInput{
		Id:     executionID,
		Reason: "integration test recovery",
	})
	require.NoError(t, err, "recover should succeed for FAILED execution")
	require.NotNil(t, recovered)

	// Verify same execution ID (not a new execution)
	assert.Equal(t, executionID, recovered.GetMetadata().GetId(),
		"recovered execution should have the same ID")

	// Verify error is cleared after recovery
	assert.Empty(t, recovered.GetStatus().GetError(),
		"recovered execution should have error cleared")

	t.Logf("recover initiated: id=%s, phase=%s",
		recovered.GetMetadata().GetId(), recovered.GetStatus().GetPhase().String())

	// Workflow execution recover starts a fresh Temporal workflow for the same
	// execution ID (unlike agent execution recover which creates a new execution).
	// The workflow will fail again on the same raise_error, but the key assertion
	// is that it actually reaches a terminal state — not stuck in a WTF loop.
	finalResult, err := waiter.WaitForTerminal(ctx, executionID, 90*time.Second)
	require.NoError(t, err, "recovered execution should reach a terminal state (not stuck)")

	assert.Equal(t, workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, finalResult.GetStatus().GetPhase(),
		"recovered execution should fail again on raise_error")

	t.Logf("recovered execution finished: id=%s, phase=%s",
		finalResult.GetMetadata().GetId(), finalResult.GetStatus().GetPhase().String())
}

// TestWorkflowExecution_Recover_IdempotentDoubleRecover verifies that calling
// recover twice on the same execution is safe — the second call either succeeds
// as a no-op (if still IN_PROGRESS) or succeeds normally (if failed again).
func TestWorkflowExecution_Recover_IdempotentDoubleRecover(t *testing.T) {
	require.NotNil(t, grpcConn)
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "wf-recover-idem", suiteLogger)
	defer deployer.Cleanup(ctx)

	wf, err := failingWorkflow("integration-test-wf-recover-idempotent")
	require.NoError(t, err)

	_, execution, err := deployer.DeployAndExecute(ctx, wf, "double recover test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)

	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, 90*time.Second)
	require.NoError(t, err, "execution should reach FAILED")

	// First recovery
	_, err = clients.ExecutionCommand.Recover(ctx, &workflowexecutionv1.RecoverWorkflowExecutionInput{
		Id:     executionID,
		Reason: "first recovery attempt",
	})
	require.NoError(t, err, "first recover should succeed")

	// Wait for it to fail again
	_, err = waiter.WaitForTerminal(ctx, executionID, 90*time.Second)
	require.NoError(t, err, "first recovery should reach terminal state")

	// Verify it failed again
	afterFirst, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, 10*time.Second)
	require.NoError(t, err, "execution should be FAILED after first recovery cycle")

	t.Logf("first recovery cycle complete: id=%s, phase=%s",
		executionID, afterFirst.GetStatus().GetPhase().String())

	// Second recovery — should also succeed
	_, err = clients.ExecutionCommand.Recover(ctx, &workflowexecutionv1.RecoverWorkflowExecutionInput{
		Id:     executionID,
		Reason: "second recovery attempt",
	})
	require.NoError(t, err, "second recover should succeed (same execution can be recovered multiple times)")

	finalResult, err := waiter.WaitForTerminal(ctx, executionID, 90*time.Second)
	require.NoError(t, err, "second recovery should reach terminal state")

	t.Logf("double recovery complete: id=%s, final_phase=%s",
		executionID, finalResult.GetStatus().GetPhase().String())
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

	_, err = waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, 30*time.Second)
	require.NoError(t, err, "execution should reach IN_PROGRESS before cancel")

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

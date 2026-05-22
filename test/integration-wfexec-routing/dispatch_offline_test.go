//go:build integration

package wfexecrouting

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// requireRunnerManager starts a UnifiedRunnerManager and registers cleanup.
func requireRunnerManager(t *testing.T, ctx context.Context) *harness.UnifiedRunnerManager {
	t.Helper()
	mgr, err := harness.StartUnifiedRunnerManager(ctx, harness.UnifiedRunnerConfig{
		StigmerServiceAddress: testHarness.Service.GRPCAddress(),
		TemporalAddress:       testHarness.Temporal.Address(),
		LogDir:                testHarness.LogDir(),
	}, suiteLogger)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			t.Skipf("unified runner not available: %v", err)
		}
		t.Fatalf("failed to start unified runner manager: %v", err)
	}
	t.Cleanup(func() {
		if err := mgr.Stop(); err != nil {
			t.Logf("warning: failed to stop runner manager: %v", err)
		}
	})
	return mgr
}

func deployTestWorkflow(t *testing.T, ctx context.Context, clients *harness.Clients, name string) *harness.FixtureDeployer {
	t.Helper()
	deployer := harness.NewFixtureDeployer(clients, name, suiteLogger)
	t.Cleanup(func() { deployer.Cleanup(context.Background()) })

	wf := newMinimalWorkflow(name)

	_, err := deployer.ApplyWorkflow(ctx, wf)
	require.NoError(t, err, "apply workflow should succeed")
	return deployer
}

func TestWfExecDispatch_RunnerPicksUpChildWorkflow(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	mgr := requireRunnerManager(t, ctx)

	deployer := deployTestWorkflow(t, ctx, clients, "dispatch-pickup-test")

	wf := newMinimalWorkflow("dispatch-pickup-test")
	_, execution, err := deployer.DeployAndExecute(ctx, wf, "dispatch test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()

	taskQueue, err := mgr.AddWorkflowExecution(ctx, executionID)
	require.NoError(t, err, "addWorkflowExecution should succeed")
	assert.Equal(t, fmt.Sprintf("wfexec:%s", executionID), taskQueue)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, executionID, 2*time.Minute)
	require.NoError(t, err, "execution should reach terminal state")

	t.Logf("execution %s reached phase %s on queue %s",
		executionID, result.GetStatus().GetPhase().String(), taskQueue)
}

func TestWfExecDispatch_AddWorkflowExecutionIdempotent(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	mgr := requireRunnerManager(t, ctx)

	deployer := deployTestWorkflow(t, ctx, clients, "idempotent-test")

	wf := newMinimalWorkflow("idempotent-test")
	_, execution, err := deployer.DeployAndExecute(ctx, wf, "idempotent test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()

	q1, err := mgr.AddWorkflowExecution(ctx, executionID)
	require.NoError(t, err, "first addWorkflowExecution should succeed")

	q2, err := mgr.AddWorkflowExecution(ctx, executionID)
	require.NoError(t, err, "second addWorkflowExecution should succeed (idempotent)")

	assert.Equal(t, q1, q2, "both calls should return the same task queue")
}

func TestWfExecDispatch_RemoveStopsPolling(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	mgr := requireRunnerManager(t, ctx)

	deployer := deployTestWorkflow(t, ctx, clients, "remove-test")

	wf := newMinimalWorkflow("remove-test")
	_, execution, err := deployer.DeployAndExecute(ctx, wf, "remove stops polling")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()

	_, err = mgr.AddWorkflowExecution(ctx, executionID)
	require.NoError(t, err)

	err = mgr.RemoveWorkflowExecution(ctx, executionID)
	require.NoError(t, err, "removeWorkflowExecution should succeed")

	// After removing the worker, the execution should NOT reach terminal
	// because no worker polls the wfexec:{id} queue.
	time.Sleep(15 * time.Second)

	result, err := clients.ExecutionQuery.Get(ctx, &workflowexecutionv1.WorkflowExecutionId{Value: executionID})
	require.NoError(t, err)

	phase := result.GetStatus().GetPhase()
	assert.NotEqual(t, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, phase,
		"execution should NOT complete after Worker was removed")
	assert.NotEqual(t, workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, phase,
		"execution should NOT fail immediately (no Worker to pick it up)")

	t.Logf("execution %s phase after removeWorkflowExecution: %s (expected non-terminal)", executionID, phase)
}

func TestWfExecDispatch_MultipleExecutionsIndependent(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	mgr := requireRunnerManager(t, ctx)

	deployer := deployTestWorkflow(t, ctx, clients, "multi-independent-test")

	wf := newMinimalWorkflow("multi-independent-test")
	_, exec1, err := deployer.DeployAndExecute(ctx, wf, "exec 1")
	require.NoError(t, err)
	_, exec2, err := deployer.DeployAndExecute(ctx, wf, "exec 2")
	require.NoError(t, err)

	id1 := exec1.GetMetadata().GetId()
	id2 := exec2.GetMetadata().GetId()

	q1, err := mgr.AddWorkflowExecution(ctx, id1)
	require.NoError(t, err)
	q2, err := mgr.AddWorkflowExecution(ctx, id2)
	require.NoError(t, err)
	assert.NotEqual(t, q1, q2, "different executions should get different queues")

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)

	result1, err := waiter.WaitForTerminal(ctx, id1, 2*time.Minute)
	require.NoError(t, err, "execution 1 should reach terminal")

	result2, err := waiter.WaitForTerminal(ctx, id2, 2*time.Minute)
	require.NoError(t, err, "execution 2 should reach terminal")

	t.Logf("exec1 %s phase=%s, exec2 %s phase=%s",
		id1, result1.GetStatus().GetPhase().String(),
		id2, result2.GetStatus().GetPhase().String())
}

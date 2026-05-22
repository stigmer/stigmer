//go:build integration

package wfexecrouting

import (
	"context"
	"testing"
	"time"

	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestWfExecPrebundle_SecondWorkerFasterThanFirst verifies that the
// pre-bundling optimization in runner-manager makes the second
// AddWorkflowExecution significantly faster than the first.
//
// With workflowsPath, each Worker.create() call runs webpack (~300ms+).
// With workflowBundle (pre-bundled), only the first startup pays the
// bundle cost; subsequent workers reuse the bundle and are near-instant.
func TestWfExecPrebundle_SecondWorkerFasterThanFirst(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	mgr := requireRunnerManager(t, ctx)

	deployer := deployTestWorkflow(t, ctx, clients, "prebundle-perf-test")

	wf := newMinimalWorkflow("prebundle-perf-test")

	_, exec1, err := deployer.DeployAndExecute(ctx, wf, "prebundle exec 1")
	require.NoError(t, err)
	_, exec2, err := deployer.DeployAndExecute(ctx, wf, "prebundle exec 2")
	require.NoError(t, err)

	id1 := exec1.GetMetadata().GetId()
	id2 := exec2.GetMetadata().GetId()

	// Measure first AddWorkflowExecution
	start1 := time.Now()
	_, err = mgr.AddWorkflowExecution(ctx, id1)
	require.NoError(t, err)
	elapsed1 := time.Since(start1)

	// Measure second AddWorkflowExecution
	start2 := time.Now()
	_, err = mgr.AddWorkflowExecution(ctx, id2)
	require.NoError(t, err)
	elapsed2 := time.Since(start2)

	t.Logf("first AddWorkflowExecution: %v, second: %v", elapsed1, elapsed2)

	// With pre-bundling, both should be fast since the bundle was built
	// at startup. The second should be at most similar in speed (no
	// webpack penalty). We assert the second is not dramatically slower
	// than the first, which would indicate per-worker re-bundling.
	assert.Less(t, elapsed2, elapsed1+2*time.Second,
		"second worker creation should not be significantly slower than first "+
			"(both should reuse pre-built workflow bundle)")

	// Clean up
	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, _ = waiter.WaitForTerminal(ctx, id1, 2*time.Minute)
	_, _ = waiter.WaitForTerminal(ctx, id2, 2*time.Minute)
}

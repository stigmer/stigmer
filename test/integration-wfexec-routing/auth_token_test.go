//go:build integration

package wfexecrouting

import (
	"context"
	"testing"
	"time"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func requireRunnerManagerWithToken(t *testing.T, ctx context.Context, token string) *harness.UnifiedRunnerManager {
	t.Helper()
	cfg := harness.UnifiedRunnerConfig{
		StigmerServiceAddress: testHarness.Service.GRPCAddress(),
		TemporalAddress:       testHarness.Temporal.Address(),
		LogDir:                testHarness.LogDir(),
		StigmerToken:          token,
	}
	mgr, err := harness.StartUnifiedRunnerManager(ctx, cfg, suiteLogger)
	if err != nil {
		t.Fatalf("failed to start unified runner manager with token: %v", err)
	}
	t.Cleanup(func() {
		if err := mgr.Stop(); err != nil {
			t.Logf("warning: failed to stop runner manager: %v", err)
		}
	})
	return mgr
}

func TestWfExecAuth_HydrationSucceedsWithToken(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	// The local Java service has no auth enforcement, so any non-empty
	// token should work. This verifies the token flows end-to-end
	// from the manager config into the runner's gRPC interceptor.
	mgr := requireRunnerManagerWithToken(t, ctx, "test-valid-token")

	deployer := deployTestWorkflow(t, ctx, clients, "auth-hydration-test")

	wf := newMinimalWorkflow("auth-hydration-test")
	_, execution, err := deployer.DeployAndExecute(ctx, wf, "auth hydration test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()

	_, err = mgr.AddWorkflowExecution(ctx, executionID)
	require.NoError(t, err, "addWorkflowExecution should succeed")

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, executionID, 2*time.Minute)
	require.NoError(t, err, "execution should reach terminal state")

	phase := result.GetStatus().GetPhase()
	t.Logf("execution %s reached phase %s with auth token", executionID, phase.String())
}

func TestWfExecAuth_TokenUpdateRefreshesCredentials(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	// Start with an initial token (valid for local dev server)
	mgr := requireRunnerManagerWithToken(t, ctx, "initial-token")

	// Update to a new token via IPC
	newToken := "refreshed-token"
	err := mgr.UpdateToken(ctx, &newToken)
	require.NoError(t, err, "updateToken should succeed")

	// After token update, operations should still work
	deployer := deployTestWorkflow(t, ctx, clients, "token-refresh-test")

	wf := newMinimalWorkflow("token-refresh-test")
	_, execution, err := deployer.DeployAndExecute(ctx, wf, "token refresh test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()

	_, err = mgr.AddWorkflowExecution(ctx, executionID)
	require.NoError(t, err, "addWorkflowExecution should succeed after token update")

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, executionID, 2*time.Minute)
	require.NoError(t, err, "execution should reach terminal state after token update")

	phase := result.GetStatus().GetPhase()
	assert.NotEqual(t,
		workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED, phase,
		"execution should not fail after token refresh")

	t.Logf("execution %s reached phase %s after token refresh", executionID, phase.String())
}

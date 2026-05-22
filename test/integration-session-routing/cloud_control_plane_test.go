//go:build integration

package sessionrouting

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCloud_SessionRoutesWithCloudTarget(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	// Create session with explicit CLOUD execution target.
	session := harness.CreateTestSession(t, ctx, clients, "",
		sessionv1.Harness_HARNESS_CURSOR,
		harness.WithExecutionTarget(sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD),
	)
	sessionID := session.GetMetadata().GetId()

	exec := harness.CreateTestAgentExecution(t, ctx, clients, sessionID, "cloud routing test")
	executionID := exec.GetMetadata().GetId()

	time.Sleep(2 * time.Second)

	// Verify the workflow was routed to the session queue even with CLOUD target.
	// The routing mode is "session" regardless of execution target — the target
	// only controls WHO provisions the runner.
	taskQueue := workflowMemoTaskQueue(t, ctx, executionID)
	expectedQueue := fmt.Sprintf("session:%s", sessionID)
	assert.Equal(t, expectedQueue, taskQueue,
		"CLOUD session should still route to session:{id} queue")

	// Start a static runner to simulate a sandbox worker on this queue.
	runner, err := harness.StartUnifiedRunnerStatic(ctx, harness.UnifiedRunnerConfig{
		StigmerServiceAddress: testHarness.Service.GRPCAddress(),
		TemporalAddress:       testHarness.Temporal.Address(),
		LogDir:                testHarness.LogDir(),
	}, expectedQueue, suiteLogger)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			t.Skipf("unified runner not available: %v", err)
		}
		t.Fatalf("failed to start static runner for cloud test: %v", err)
	}
	t.Cleanup(func() {
		if err := runner.Stop(); err != nil {
			t.Logf("warning: failed to stop static runner: %v", err)
		}
	})

	// Without a Cursor API key, execution fails — but it proves the sandbox
	// runner picked up the activity from the session queue.
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, executionID, 2*time.Minute)
	require.NoError(t, err, "execution should reach terminal state")

	assert.Equal(t, agentexecv1.ExecutionPhase_EXECUTION_FAILED, result.GetStatus().GetPhase(),
		"CLOUD execution should fail without API key (proves static runner picked up activity)")

	t.Logf("CLOUD routing verified: execution %s dispatched to %s, picked up by static runner",
		executionID, taskQueue)
}

func TestCloud_NoopSandboxProvisionerDoesNotBlock(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	// Create a CLOUD session. The Java service has sandbox type "noop", so
	// EnsureSessionSandboxStep should fire but be a no-op. The execution
	// should still be created and the workflow should start — provisioning
	// failures are non-critical.
	session := harness.CreateTestSession(t, ctx, clients, "",
		sessionv1.Harness_HARNESS_CURSOR,
		harness.WithExecutionTarget(sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD),
	)
	sessionID := session.GetMetadata().GetId()

	exec := harness.CreateTestAgentExecution(t, ctx, clients, sessionID, "noop sandbox test")
	executionID := exec.GetMetadata().GetId()
	require.NotEmpty(t, executionID, "execution should be created despite noop sandbox")

	time.Sleep(2 * time.Second)

	// Verify the workflow was actually started in Temporal.
	taskQueue := workflowMemoTaskQueue(t, ctx, executionID)
	require.NotEmpty(t, taskQueue, "workflow should have started despite noop sandbox provisioner")

	t.Logf("noop sandbox: execution %s created successfully, workflow started with queue %s",
		executionID, taskQueue)
}

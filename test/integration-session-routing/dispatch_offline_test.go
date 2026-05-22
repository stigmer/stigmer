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

// requireRunnerManager starts a UnifiedRunnerManager and registers cleanup.
// Skips the test if the unified runner is not available.
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

func TestDispatch_RunnerManagerPicksUpActivity(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	mgr := requireRunnerManager(t, ctx)

	session := harness.CreateTestSession(t, ctx, clients, "", sessionv1.Harness_HARNESS_CURSOR)
	sessionID := session.GetMetadata().GetId()

	taskQueue, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err, "addSession should succeed")
	assert.Equal(t, fmt.Sprintf("session:%s", sessionID), taskQueue)

	exec := harness.CreateTestAgentExecution(t, ctx, clients, sessionID, "dispatch test")
	executionID := exec.GetMetadata().GetId()

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, executionID, 2*time.Minute)
	require.NoError(t, err, "execution should reach terminal state")

	// Without a Cursor API key, ExecuteCursor fails — the execution reaches
	// FAILED. This is expected. The key assertion is that it DID reach a
	// terminal state, meaning the activity was dispatched to and picked up
	// by the runner manager's session Worker.
	assert.Equal(t, agentexecv1.ExecutionPhase_EXECUTION_FAILED, result.GetStatus().GetPhase(),
		"execution should fail without API key (proves runner picked up the activity)")

	t.Logf("execution %s reached FAILED on queue %s (expected — no API key)", executionID, taskQueue)
}

func TestDispatch_AddSessionIdempotent(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	mgr := requireRunnerManager(t, ctx)

	session := harness.CreateTestSession(t, ctx, clients, "", sessionv1.Harness_HARNESS_CURSOR)
	sessionID := session.GetMetadata().GetId()

	q1, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err, "first addSession should succeed")

	q2, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err, "second addSession should succeed (idempotent)")

	assert.Equal(t, q1, q2, "both calls should return the same task queue")
}

func TestDispatch_RemoveSessionStopsWorker(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	mgr := requireRunnerManager(t, ctx)

	session := harness.CreateTestSession(t, ctx, clients, "", sessionv1.Harness_HARNESS_CURSOR)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err)

	err = mgr.RemoveSession(ctx, sessionID)
	require.NoError(t, err, "removeSession should succeed")

	// Create an execution after the Worker is gone. The activity should not
	// be picked up — the execution stays in a non-terminal state until
	// ScheduleToStartTimeout (5 minutes). We verify it does NOT reach
	// terminal state within a short window.
	exec := harness.CreateTestAgentExecution(t, ctx, clients, sessionID, "after remove")
	executionID := exec.GetMetadata().GetId()

	time.Sleep(10 * time.Second)

	result, err := clients.AgentExecutionQuery.Get(ctx, &agentexecv1.AgentExecutionId{Value: executionID})
	require.NoError(t, err)

	phase := result.GetStatus().GetPhase()
	assert.NotEqual(t, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, phase,
		"execution should NOT complete after Worker was removed")
	assert.NotEqual(t, agentexecv1.ExecutionPhase_EXECUTION_FAILED, phase,
		"execution should NOT fail immediately (no Worker to pick it up)")

	t.Logf("execution %s phase after removeSession: %s (expected non-terminal)", executionID, phase)
}

func TestDispatch_MultipleSessionsIndependent(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	mgr := requireRunnerManager(t, ctx)

	session1 := harness.CreateTestSession(t, ctx, clients, "", sessionv1.Harness_HARNESS_CURSOR)
	session2 := harness.CreateTestSession(t, ctx, clients, "", sessionv1.Harness_HARNESS_CURSOR)
	sid1 := session1.GetMetadata().GetId()
	sid2 := session2.GetMetadata().GetId()

	q1, err := mgr.AddSession(ctx, sid1)
	require.NoError(t, err)
	q2, err := mgr.AddSession(ctx, sid2)
	require.NoError(t, err)
	assert.NotEqual(t, q1, q2, "different sessions should get different queues")

	exec1 := harness.CreateTestAgentExecution(t, ctx, clients, sid1, "session 1 dispatch")
	exec2 := harness.CreateTestAgentExecution(t, ctx, clients, sid2, "session 2 dispatch")

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	result1, err := waiter.WaitForTerminal(ctx, exec1.GetMetadata().GetId(), 2*time.Minute)
	require.NoError(t, err, "session 1 execution should reach terminal")

	result2, err := waiter.WaitForTerminal(ctx, exec2.GetMetadata().GetId(), 2*time.Minute)
	require.NoError(t, err, "session 2 execution should reach terminal")

	// Both should fail (no API key) but independently — proving each Worker
	// handles its own session's activities.
	assert.Equal(t, agentexecv1.ExecutionPhase_EXECUTION_FAILED, result1.GetStatus().GetPhase())
	assert.Equal(t, agentexecv1.ExecutionPhase_EXECUTION_FAILED, result2.GetStatus().GetPhase())

	t.Logf("session1 exec %s and session2 exec %s both reached FAILED independently",
		exec1.GetMetadata().GetId(), exec2.GetMetadata().GetId())
}

//go:build integration

package sessionrouting

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func requireCursorKey(t *testing.T) {
	t.Helper()
	if cursorKey == "" {
		t.Skip("CURSOR_API_KEY not set — skipping provider-backed E2E test")
	}
}

// requireRunnerManagerWithCursor starts a runner manager with the Cursor API
// key configured so ExecuteCursor activities can complete successfully.
func requireRunnerManagerWithCursor(t *testing.T, ctx context.Context) *harness.UnifiedRunnerManager {
	t.Helper()
	requireCursorKey(t)

	svc := testHarness.Service
	pathProxy, err := harness.NewPathRoutingProxy(svc.HTTPAddress(), svc.BiDiProxyAddress())
	if err != nil {
		t.Fatalf("failed to start path routing proxy: %v", err)
	}
	t.Cleanup(func() { pathProxy.Close() })

	mgr, err := harness.StartUnifiedRunnerManager(ctx, harness.UnifiedRunnerConfig{
		StigmerServiceAddress: svc.GRPCAddress(),
		TemporalAddress:       testHarness.Temporal.Address(),
		LogDir:                testHarness.LogDir(),
		CursorAPIKey:          cursorKey,
		ProxyEndpoint:         pathProxy.Address(),
	}, suiteLogger)
	if err != nil {
		t.Fatalf("failed to start unified runner manager with cursor key: %v", err)
	}
	t.Cleanup(func() {
		if err := mgr.Stop(); err != nil {
			t.Logf("warning: failed to stop runner manager: %v", err)
		}
	})
	return mgr
}

func TestE2E_CursorSessionRouting_Completes(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	mgr := requireRunnerManagerWithCursor(t, ctx)

	session := harness.CreateTestSession(t, ctx, clients, "", sessionv1.Harness_HARNESS_CURSOR)
	sessionID := session.GetMetadata().GetId()

	taskQueue, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err)
	t.Logf("session %s → queue %s", sessionID, taskQueue)

	exec := harness.CreateTestAgentExecution(t, ctx, clients, sessionID,
		"Say exactly: 'Session routing works.' Nothing else.")
	executionID := exec.GetMetadata().GetId()

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForTerminal(ctx, executionID, 4*time.Minute)
	require.NoError(t, err, "execution should reach terminal state")

	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// Verify the workflow used the session queue.
	memoQueue := workflowMemoTaskQueue(t, ctx, executionID)
	assert.Equal(t, fmt.Sprintf("session:%s", sessionID), memoQueue)

	t.Logf("E2E success: execution %s completed on queue %s", executionID, memoQueue)
}

func TestE2E_ConcurrentSessions_IndependentCompletion(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	mgr := requireRunnerManagerWithCursor(t, ctx)

	session1 := harness.CreateTestSession(t, ctx, clients, "", sessionv1.Harness_HARNESS_CURSOR)
	session2 := harness.CreateTestSession(t, ctx, clients, "", sessionv1.Harness_HARNESS_CURSOR)
	sid1 := session1.GetMetadata().GetId()
	sid2 := session2.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sid1)
	require.NoError(t, err)
	_, err = mgr.AddSession(ctx, sid2)
	require.NoError(t, err)

	exec1 := harness.CreateTestAgentExecution(t, ctx, clients, sid1,
		"Say exactly: 'Session one.' Nothing else.")
	exec2 := harness.CreateTestAgentExecution(t, ctx, clients, sid2,
		"Say exactly: 'Session two.' Nothing else.")

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

	var wg sync.WaitGroup
	var result1, result2 *agentexecv1.AgentExecution
	var err1, err2 error

	wg.Add(2)
	go func() {
		defer wg.Done()
		result1, err1 = waiter.WaitForTerminal(ctx, exec1.GetMetadata().GetId(), 4*time.Minute)
	}()
	go func() {
		defer wg.Done()
		result2, err2 = waiter.WaitForTerminal(ctx, exec2.GetMetadata().GetId(), 4*time.Minute)
	}()
	wg.Wait()

	require.NoError(t, err1, "session 1 execution should complete")
	require.NoError(t, err2, "session 2 execution should complete")

	harness.AssertAgentPhase(t, result1, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertAgentPhase(t, result2, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("concurrent sessions: both completed independently on their own queues")
}

func TestE2E_FollowUpMessage_SameSessionQueue(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	mgr := requireRunnerManagerWithCursor(t, ctx)

	session := harness.CreateTestSession(t, ctx, clients, "", sessionv1.Harness_HARNESS_CURSOR)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err)

	// First message.
	exec1 := harness.CreateTestAgentExecution(t, ctx, clients, sessionID,
		"Say exactly: 'First message.' Nothing else.")
	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result1, err := waiter.WaitForTerminal(ctx, exec1.GetMetadata().GetId(), 4*time.Minute)
	require.NoError(t, err)
	harness.AssertAgentPhase(t, result1, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// Follow-up message on the same session — routes to the same queue.
	exec2 := harness.CreateTestAgentExecution(t, ctx, clients, sessionID,
		"Say exactly: 'Follow-up message.' Nothing else.")
	result2, err := waiter.WaitForTerminal(ctx, exec2.GetMetadata().GetId(), 4*time.Minute)
	require.NoError(t, err)
	harness.AssertAgentPhase(t, result2, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	// Verify both used the same session queue.
	q1 := workflowMemoTaskQueue(t, ctx, exec1.GetMetadata().GetId())
	q2 := workflowMemoTaskQueue(t, ctx, exec2.GetMetadata().GetId())
	assert.Equal(t, q1, q2, "follow-up message should use the same session queue")
	assert.Equal(t, fmt.Sprintf("session:%s", sessionID), q1)

	t.Logf("follow-up: both executions routed to %s", q1)
}

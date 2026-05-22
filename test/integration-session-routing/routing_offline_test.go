//go:build integration

package sessionrouting

import (
	"context"
	"fmt"
	"testing"
	"time"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/converter"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// workflowMemoTaskQueue queries the Temporal dev server for the workflow
// associated with the given execution ID and extracts the activityTaskQueue
// memo value. This verifies that the Java service's dispatch pipeline
// correctly set the per-session task queue in the workflow memo.
func workflowMemoTaskQueue(t *testing.T, ctx context.Context, executionID string) string {
	t.Helper()

	workflowID := fmt.Sprintf("stigmer/agent-execution/invoke/%s", executionID)

	resp, err := temporalClient.DescribeWorkflowExecution(ctx, workflowID, "")
	require.NoError(t, err, "DescribeWorkflowExecution should succeed for workflow %s", workflowID)
	require.NotNil(t, resp.WorkflowExecutionInfo, "workflow execution info should be present")

	memo := resp.WorkflowExecutionInfo.GetMemo()
	require.NotNil(t, memo, "workflow memo should be present")

	payload, ok := memo.GetFields()["activityTaskQueue"]
	require.True(t, ok, "memo should contain activityTaskQueue key")

	var taskQueue string
	err = converter.GetDefaultDataConverter().FromPayload(payload, &taskQueue)
	require.NoError(t, err, "should decode activityTaskQueue memo value")
	require.NotEmpty(t, taskQueue, "activityTaskQueue should not be empty")

	return taskQueue
}

func TestSessionRouting_WorkflowMemoHasSessionQueue(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	session := harness.CreateTestSession(t, ctx, clients, "", sessionv1.Harness_HARNESS_CURSOR)
	sessionID := session.GetMetadata().GetId()
	require.NotEmpty(t, sessionID)

	exec := harness.CreateTestAgentExecution(t, ctx, clients, sessionID, "hello")
	executionID := exec.GetMetadata().GetId()

	// Give Temporal a moment to register the workflow.
	time.Sleep(2 * time.Second)

	taskQueue := workflowMemoTaskQueue(t, ctx, executionID)

	expectedQueue := fmt.Sprintf("session:%s", sessionID)
	assert.Equal(t, expectedQueue, taskQueue,
		"workflow memo activityTaskQueue should be session:{sessionId}")

	t.Logf("verified: execution %s → workflow memo activityTaskQueue = %s", executionID, taskQueue)
}

func TestSessionRouting_DefaultExecutionTargetResolution(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	// Create session with UNSPECIFIED execution target — the service should
	// resolve it to LOCAL (configured default in suite_test.go).
	session := harness.CreateTestSession(t, ctx, clients, "", sessionv1.Harness_HARNESS_CURSOR)
	sessionID := session.GetMetadata().GetId()

	exec := harness.CreateTestAgentExecution(t, ctx, clients, sessionID, "test default target")
	executionID := exec.GetMetadata().GetId()

	time.Sleep(2 * time.Second)

	// The memo should still have session:{id} because activity routing is
	// "session" regardless of execution target. Execution target controls
	// WHO provides the runner, not WHERE activities route.
	taskQueue := workflowMemoTaskQueue(t, ctx, executionID)
	expectedQueue := fmt.Sprintf("session:%s", sessionID)
	assert.Equal(t, expectedQueue, taskQueue)
}

func TestSessionRouting_ExecutionTargetImmutability(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	session := harness.CreateTestSession(t, ctx, clients, "", sessionv1.Harness_HARNESS_CURSOR)
	sessionID := session.GetMetadata().GetId()

	// Create an execution and simulate the runner binding to the session by
	// setting harness_state_id. The immutability guard only fires when
	// harness_state_id is non-empty (indicating infrastructure is bound).
	harness.CreateTestAgentExecution(t, ctx, clients, sessionID, "lock target")

	// Seed harness_state_id to simulate the runner having bound.
	_, err := clients.SessionCommand.Update(ctx, &sessionv1.Session{
		ApiVersion: testAPIVersion,
		Kind:       "Session",
		Metadata:   session.GetMetadata(),
		Spec: &sessionv1.SessionSpec{
			AgentInstanceId: session.GetSpec().GetAgentInstanceId(),
			Subject:         session.GetSpec().GetSubject(),
			Harness:         session.GetSpec().GetHarness(),
			HarnessStateId:  "simulated-cursor-agent-id",
		},
	})
	require.NoError(t, err, "seeding harness_state_id should succeed")

	// Re-fetch the session to get the latest metadata version.
	session, err = clients.SessionQuery.Get(ctx, &sessionv1.SessionId{Value: sessionID})
	require.NoError(t, err)

	// Attempt to change execution_target on the session — should be rejected.
	_, err = clients.SessionCommand.Update(ctx, &sessionv1.Session{
		ApiVersion: testAPIVersion,
		Kind:       "Session",
		Metadata:   session.GetMetadata(),
		Spec: &sessionv1.SessionSpec{
			AgentInstanceId: session.GetSpec().GetAgentInstanceId(),
			Subject:         session.GetSpec().GetSubject(),
			Harness:         session.GetSpec().GetHarness(),
			HarnessStateId:  session.GetSpec().GetHarnessStateId(),
			ExecutionTarget: sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD,
		},
	})

	require.Error(t, err, "updating execution_target after execution should fail")
	st, ok := status.FromError(err)
	if ok {
		assert.Equal(t, codes.FailedPrecondition, st.Code(),
			"expected FAILED_PRECONDITION, got %s: %s", st.Code(), st.Message())
		t.Logf("immutability guard rejected update: %s", st.Message())
	}
}

func TestSessionRouting_MultipleSessionsGetDistinctQueues(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	session1 := harness.CreateTestSession(t, ctx, clients, "", sessionv1.Harness_HARNESS_CURSOR)
	session2 := harness.CreateTestSession(t, ctx, clients, "", sessionv1.Harness_HARNESS_CURSOR)

	exec1 := harness.CreateTestAgentExecution(t, ctx, clients, session1.GetMetadata().GetId(), "session 1")
	exec2 := harness.CreateTestAgentExecution(t, ctx, clients, session2.GetMetadata().GetId(), "session 2")

	time.Sleep(2 * time.Second)

	q1 := workflowMemoTaskQueue(t, ctx, exec1.GetMetadata().GetId())
	q2 := workflowMemoTaskQueue(t, ctx, exec2.GetMetadata().GetId())

	assert.NotEqual(t, q1, q2, "different sessions should route to different queues")
	assert.Equal(t, fmt.Sprintf("session:%s", session1.GetMetadata().GetId()), q1)
	assert.Equal(t, fmt.Sprintf("session:%s", session2.GetMetadata().GetId()), q2)

	t.Logf("session1 → %s, session2 → %s", q1, q2)
}

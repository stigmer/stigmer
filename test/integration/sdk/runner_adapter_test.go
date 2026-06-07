//go:build integration

package sdk_test

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	stigmer "github.com/stigmer/stigmer/sdk/go"
	sessionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/session/v1"
	workflowv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// recordingAdapter is a thread-safe mock RunnerAdapter that records all calls.
type recordingAdapter struct {
	mu                   sync.Mutex
	sessionsOpened       []string
	sessionsClosed       []string
	executionsCreated    []string
	executionsTerminated []string
}

func (r *recordingAdapter) OnSessionOpened(_ context.Context, sessionID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessionsOpened = append(r.sessionsOpened, sessionID)
	return nil
}

func (r *recordingAdapter) OnSessionClosed(_ context.Context, sessionID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessionsClosed = append(r.sessionsClosed, sessionID)
	return nil
}

func (r *recordingAdapter) OnWorkflowExecutionCreated(_ context.Context, executionID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.executionsCreated = append(r.executionsCreated, executionID)
	return nil
}

func (r *recordingAdapter) OnWorkflowExecutionTerminated(_ context.Context, executionID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.executionsTerminated = append(r.executionsTerminated, executionID)
	return nil
}

func (r *recordingAdapter) getSessionsOpened() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, len(r.sessionsOpened))
	copy(out, r.sessionsOpened)
	return out
}

func (r *recordingAdapter) getExecutionsCreated() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, len(r.executionsCreated))
	copy(out, r.executionsCreated)
	return out
}

func (r *recordingAdapter) getExecutionsTerminated() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, len(r.executionsTerminated))
	copy(out, r.executionsTerminated)
	return out
}

// TestRunnerAdapter_SessionLifecycle verifies the RunnerAdapter is wired
// correctly on the client and receives lifecycle callbacks when the
// consumer triggers them after session creation.
func TestRunnerAdapter_SessionLifecycle(t *testing.T) {
	addr := grpcAddress(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	adapter := &recordingAdapter{}
	client, err := stigmer.NewClient(
		stigmer.WithBaseURL(addr),
		stigmer.WithInsecure(),
		stigmer.WithExecutionTarget(sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL),
		stigmer.WithRunnerAdapter(adapter),
	)
	require.NoError(t, err)
	defer client.Close()

	require.NoError(t, client.Connect(ctx))
	require.NotNil(t, client.RunnerAdapter, "adapter must be stored on client")

	testName := fmt.Sprintf("runner-adapter-session-%d", time.Now().UnixMilli())

	// Create an agent to bind the session to
	agent, err := client.Agent.Apply(ctx, &stigmer.AgentInput{
		Name:         testName,
		Org:          "test-org",
		Instructions: "Test agent for runner adapter integration test",
	})
	require.NoError(t, err)
	agentID := agent.GetMetadata().GetId()
	instanceID := agent.GetStatus().GetDefaultInstanceId()
	t.Logf("created agent: id=%s, instanceId=%s", agentID, instanceID)

	t.Cleanup(func() {
		cleanCtx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		client.Agent.Delete(cleanCtx, agentID)
	})

	// Create a session with execution target LOCAL
	session, err := client.Session.Create(ctx, &stigmer.SessionInput{
		Name:            testName + "-session",
		Org:             "test-org",
		AgentInstanceId: instanceID,
		ExecutionTarget: sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL,
	})
	require.NoError(t, err)
	sessionID := session.GetMetadata().GetId()
	t.Logf("created session: id=%s", sessionID)

	t.Cleanup(func() {
		cleanCtx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		client.Session.Delete(cleanCtx, sessionID)
	})

	// Consumer calls the adapter when the session is opened
	// (This is what the React SDK does automatically via useSessionConversation;
	// in Go, the consumer invokes it explicitly until auto-wiring is added.)
	require.NotNil(t, client.RunnerAdapter)
	err = client.RunnerAdapter.OnSessionOpened(ctx, sessionID)
	require.NoError(t, err, "adapter.OnSessionOpened must succeed")

	// Verify the adapter recorded the call
	opened := adapter.getSessionsOpened()
	require.Len(t, opened, 1)
	assert.Equal(t, sessionID, opened[0])
}

// TestRunnerAdapter_WorkflowExecutionLifecycle verifies the full
// workflow execution lifecycle with the RunnerAdapter — from creation
// through terminal phase detection and cleanup.
func TestRunnerAdapter_WorkflowExecutionLifecycle(t *testing.T) {
	addr := grpcAddress(t)

	if !workflowRunnerAvailable() {
		t.Skip("unified runner not available — skipping workflow execution adapter test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	adapter := &recordingAdapter{}
	client, err := stigmer.NewClient(
		stigmer.WithBaseURL(addr),
		stigmer.WithInsecure(),
		stigmer.WithExecutionTarget(sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL),
		stigmer.WithRunnerAdapter(adapter),
	)
	require.NoError(t, err)
	defer client.Close()

	require.NoError(t, client.Connect(ctx))

	testName := fmt.Sprintf("runner-adapter-wfexec-%d", time.Now().UnixMilli())

	// Create a fast workflow (set_vars → completes immediately)
	workflow, err := client.Workflow.Apply(ctx, &stigmer.WorkflowInput{
		Name: testName,
		Org:  "test-org",
		Document: &stigmer.WorkflowDocumentInput{
			Dsl:       "1.0.0",
			Namespace: "test-org",
			Name:      testName,
			Version:   "1.0.0",
		},
		Tasks: []*stigmer.WorkflowTaskInput{
			{
				Name: "setResult",
				Kind: workflowv1.WorkflowTaskKind_set_vars,
				TaskConfig: map[string]any{
					"variables": map[string]any{
						"adapter_test": "passed",
					},
				},
				Export: &stigmer.ExportInput{As: "${.}"},
			},
		},
	})
	require.NoError(t, err)
	workflowID := workflow.GetMetadata().GetId()
	t.Logf("applied workflow: id=%s", workflowID)

	t.Cleanup(func() {
		cleanCtx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		client.Workflow.Delete(cleanCtx, workflowID)
	})

	// Create execution
	execution, err := client.WorkflowExecution.Create(ctx, &stigmer.WorkflowExecutionInput{
		Name:           testName + "-exec",
		Org:            "test-org",
		WorkflowId:     workflowID,
		TriggerMessage: "RunnerAdapter integration test",
	})
	require.NoError(t, err)
	executionID := execution.GetMetadata().GetId()
	t.Logf("created execution: id=%s", executionID)

	// Simulate what the React SDK does: call adapter after successful creation
	err = client.RunnerAdapter.OnWorkflowExecutionCreated(ctx, executionID)
	require.NoError(t, err, "adapter.OnWorkflowExecutionCreated must succeed")

	// Verify adapter recorded the creation callback
	createdExecs := adapter.getExecutionsCreated()
	require.Len(t, createdExecs, 1)
	assert.Equal(t, executionID, createdExecs[0])

	// Poll until execution reaches terminal phase
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	var finalExecution *workflowexecutionv1.WorkflowExecution
	for {
		select {
		case <-ctx.Done():
			t.Fatalf("timed out waiting for execution to complete; last phase: %s",
				finalExecution.GetStatus().GetPhase().String())
		case <-ticker.C:
			finalExecution, err = client.WorkflowExecution.Get(ctx, executionID)
			require.NoError(t, err)

			phase := finalExecution.GetStatus().GetPhase()
			if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED ||
				phase == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED ||
				phase == workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED ||
				phase == workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED {
				t.Logf("execution reached terminal phase: %s", phase.String())
				goto terminal
			}
		}
	}
terminal:

	// On terminal phase detection, call adapter terminate
	// (This is what the React SDK's useWorkflowExecution hook does automatically.)
	err = client.RunnerAdapter.OnWorkflowExecutionTerminated(ctx, executionID)
	require.NoError(t, err, "adapter.OnWorkflowExecutionTerminated must succeed")

	// Verify full lifecycle was recorded
	terminatedExecs := adapter.getExecutionsTerminated()
	require.Len(t, terminatedExecs, 1)
	assert.Equal(t, executionID, terminatedExecs[0])

	// Verify execution completed successfully
	assert.Equal(t,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		finalExecution.GetStatus().GetPhase(),
		"execution must complete successfully",
	)
}

// TestRunnerAdapter_NilAdapter_NoOp verifies that a client without a
// RunnerAdapter configured works correctly — nil adapter doesn't cause
// panics and consumers can guard with a nil check.
func TestRunnerAdapter_NilAdapter_NoOp(t *testing.T) {
	addr := grpcAddress(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	client, err := stigmer.NewClient(
		stigmer.WithBaseURL(addr),
		stigmer.WithInsecure(),
	)
	require.NoError(t, err)
	defer client.Close()

	require.NoError(t, client.Connect(ctx))
	assert.Nil(t, client.RunnerAdapter, "adapter must be nil when not configured")

	// Consumer pattern: guard with nil check before calling adapter
	if client.RunnerAdapter != nil {
		t.Fatal("unexpected: adapter should be nil")
	}
}

// TestRunnerAdapter_Idempotent verifies that calling adapter methods
// multiple times with the same ID is safe (the adapter should handle
// idempotency gracefully).
func TestRunnerAdapter_Idempotent(t *testing.T) {
	addr := grpcAddress(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	adapter := &recordingAdapter{}
	client, err := stigmer.NewClient(
		stigmer.WithBaseURL(addr),
		stigmer.WithInsecure(),
		stigmer.WithRunnerAdapter(adapter),
	)
	require.NoError(t, err)
	defer client.Close()

	require.NoError(t, client.Connect(ctx))

	// Call the same session ID multiple times
	for i := 0; i < 3; i++ {
		err = client.RunnerAdapter.OnSessionOpened(ctx, "idempotent-session-id")
		require.NoError(t, err)
	}

	// All calls should be recorded — adapter must handle duplicates internally
	opened := adapter.getSessionsOpened()
	assert.Len(t, opened, 3, "adapter records all calls; real adapters handle deduplication internally")

	// Close the same session multiple times
	for i := 0; i < 2; i++ {
		err = client.RunnerAdapter.OnSessionClosed(ctx, "idempotent-session-id")
		require.NoError(t, err)
	}
}

package activities

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// EnsureThreadActivity is the interface for ensuring a thread exists for agent execution.
//
// This activity is implemented in Python (agent-runner) and:
// 1. If session exists: fetches session, checks/creates thread, updates session
// 2. If no session: creates ephemeral thread
//
// Returns the thread ID to be used for agent invocation.
type EnsureThreadActivity interface {
	// EnsureThread ensures a thread exists for the agent execution.
	//
	// sessionID: The session ID (empty string if no session)
	// agentID: The agent ID
	//
	// Returns: The thread ID to use for execution
	EnsureThread(sessionID string, agentID string) (string, error)
}

// EnsureThreadActivityName is the activity name used for registration.
// This MUST match the Python activity name exactly for polyglot to work.
const EnsureThreadActivityName = "EnsureThread"

// NewEnsureThreadActivityStub creates an activity stub for calling EnsureThread from workflows.
// This is used by workflow implementations to call the Python activity.
func NewEnsureThreadActivityStub(ctx workflow.Context, taskQueue string) EnsureThreadActivity {
	// Create activity options with explicit task queue routing to Python worker
	options := workflow.ActivityOptions{
		TaskQueue:              taskQueue, // Route to Python worker (from memo)
		StartToCloseTimeout:    30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts:    3,
			InitialInterval:    5 * time.Second,
			BackoffCoefficient: 2.0,
		},
	}

	ctx = workflow.WithActivityOptions(ctx, options)
	
	return &ensureThreadActivityStub{ctx: ctx}
}

// ensureThreadActivityStub is the internal stub implementation.
type ensureThreadActivityStub struct {
	ctx workflow.Context
}

func (s *ensureThreadActivityStub) EnsureThread(sessionID string, agentID string) (string, error) {
	var result string
	err := workflow.ExecuteActivity(s.ctx, EnsureThreadActivityName, sessionID, agentID).Get(s.ctx, &result)
	return result, err
}

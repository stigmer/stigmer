package activities

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// EnsureThreadActivity is the interface for ensuring a thread exists for agent execution.
//
// This activity is implemented in the TypeScript unified runner
// (backend/services/runner/src/activities/ensure-thread.ts) and:
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
// This is a WIRE IDENTIFIER: it must match the runner's registration exactly
// (and stay byte-identical for in-flight workflow compatibility).
const EnsureThreadActivityName = "EnsureThread"

// NewEnsureThreadActivityStub creates an activity stub for calling EnsureThread from workflows.
// This is used by workflow implementations to call the runner activity.
func NewEnsureThreadActivityStub(ctx workflow.Context, taskQueue string) EnsureThreadActivity {
	// Create activity options with explicit task queue routing to the runner
	options := workflow.ActivityOptions{
		TaskQueue:              taskQueue,        // Route to the runner worker (from memo)
		StartToCloseTimeout:    30 * time.Second, // Fast operation
		ScheduleToStartTimeout: 5 * time.Minute,  // Max wait for worker to pick up task (matches Java cloud)
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts:    3, // Retry up to 3 times (idempotent operation)
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

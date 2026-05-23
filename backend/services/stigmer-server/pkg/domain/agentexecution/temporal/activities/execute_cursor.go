package activities

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// ExecuteCursorActivity is the interface for executing Cursor harness agents.
//
// Returns RunnerActivityResult (map[string]interface{}) to preserve both
// proto fields (phase, pendingApprovals) and non-proto fields
// (structured_output, final_text) from the TS runner.
//
// threadID stores the Cursor agentId. On the first execution, the activity
// creates a Cursor Agent, stores its agentId as session.spec.harness_state_id,
// and returns. The workflow reads it back via ReadHarnessStateId on reinvocation.
//
// Unified Runner Architecture:
// Both ExecuteCursor and ExecuteDeepAgent are registered on the same activity
// task queue (global: agent_execution_runner, or per-session: session:{id}).
// Temporal routes by activity name — no queue suffix is needed. The workflow
// dispatches to the correct activity based on session.spec.harness.
type ExecuteCursorActivity interface {
	ExecuteCursor(executionID string, threadID string) (RunnerActivityResult, error)
}

// ExecuteCursorActivityName is the activity name used for registration.
// This MUST match the TypeScript runner activity name exactly.
const ExecuteCursorActivityName = "ExecuteCursor"

func NewExecuteCursorActivityStub(ctx workflow.Context, taskQueue string) ExecuteCursorActivity {
	options := workflow.ActivityOptions{
		TaskQueue:              taskQueue,
		StartToCloseTimeout:    24 * time.Hour,
		ScheduleToStartTimeout: 1 * time.Minute,
		HeartbeatTimeout:       2 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts:    1,
			InitialInterval:    10 * time.Second,
			BackoffCoefficient: 2.0,
		},
	}

	ctx = workflow.WithActivityOptions(ctx, options)

	return &executeCursorActivityStub{ctx: ctx}
}

type executeCursorActivityStub struct {
	ctx workflow.Context
}

func (s *executeCursorActivityStub) ExecuteCursor(executionID string, threadID string) (RunnerActivityResult, error) {
	var result RunnerActivityResult
	err := workflow.ExecuteActivity(s.ctx, ExecuteCursorActivityName, executionID, threadID).Get(s.ctx, &result)
	return result, err
}

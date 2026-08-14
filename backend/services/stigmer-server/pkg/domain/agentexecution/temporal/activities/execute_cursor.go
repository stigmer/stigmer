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
// task queue (global: stigmer_runner, or per-session: session:{id}).
// Temporal routes by activity name — no queue suffix is needed. The workflow
// dispatches to the correct activity based on session.spec.harness.
// ExecuteCursorActivityInput is the typed input for the ExecuteCursor activity.
//
// Modeled on the workflow-input convention (a single serializable object with
// snake_case JSON keys) so the Go control plane, the Java control plane, and
// the single TypeScript runner all agree on one wire shape — ending the prior
// positional-arg drift (Go sent 2 args, Java sent 3, the runner read 2). The
// JSON keys here MUST stay byte-identical to the Java record
// (ExecuteCursorActivityInput, @JsonNaming snake_case) and the runner's
// normalized input object.
type ExecuteCursorActivityInput struct {
	// ExecutionID is the agent execution being run.
	ExecutionID string `json:"execution_id"`
	// ThreadID stores the Cursor agentId (harness_state_id); empty on first run.
	ThreadID string `json:"thread_id"`
	// InvokerIdentityAccountID is carried for parity with the Java edition; the
	// runner hydrates the invoker from the DB and does not read this field.
	InvokerIdentityAccountID string `json:"invoker_identity_account_id"`
	// TurnSeq is the monotonic HITL-cycle index within this execution: 0 on the
	// first invocation, then the workflow's approvalCycle on each reinvocation.
	// The runner mints the deterministic file-review change-set id
	// (executionId:turnSeq) from it. It is identical across a Temporal retry of
	// the same invocation (the workflow passes the same value), so ledger
	// authoring stays idempotent. See the file-change HITL redesign.
	TurnSeq int64 `json:"turn_seq"`
}

type ExecuteCursorActivity interface {
	ExecuteCursor(input ExecuteCursorActivityInput) (RunnerActivityResult, error)
}

// ExecuteCursorActivityName is the activity name used for registration.
// This MUST match the TypeScript runner activity name exactly.
const ExecuteCursorActivityName = "ExecuteCursor"

func NewExecuteCursorActivityStub(ctx workflow.Context, taskQueue string) ExecuteCursorActivity {
	options := workflow.ActivityOptions{
		TaskQueue:              taskQueue,
		StartToCloseTimeout:    24 * time.Hour,
		ScheduleToStartTimeout: 5 * time.Minute,
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

func (s *executeCursorActivityStub) ExecuteCursor(input ExecuteCursorActivityInput) (RunnerActivityResult, error) {
	var result RunnerActivityResult
	err := workflow.ExecuteActivity(s.ctx, ExecuteCursorActivityName, input).Get(s.ctx, &result)
	return result, err
}

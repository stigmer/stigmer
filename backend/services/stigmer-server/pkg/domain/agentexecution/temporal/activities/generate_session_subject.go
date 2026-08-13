package activities

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// GenerateSessionSubjectActivity is the interface for generating a human-readable
// session subject from the user's first message and agent context.
//
// This activity is implemented in the TypeScript unified runner
// (backend/services/runner/src/activities/generate-session-subject.ts) and:
// 1. Hydrates the execution via gRPC to get session_id, agent_id, user_message
// 2. Checks the session subject is still the auto-created sentinel
// 3. Fetches the agent name and description for LLM context
// 4. Calls an economy-tier LLM to produce a concise title (3–7 words)
// 5. Updates the session subject via the race-safe updateSubject RPC
//
// The activity is intentionally fire-and-forget: failures are non-critical and
// must never affect the main execution path. A missing subject simply falls back
// to displaying the session ID in the CLI header.
//
// Slim-Payload Pattern:
// Receives only executionID and hydrates the full execution from the database,
// keeping Temporal payloads small.
type GenerateSessionSubjectActivity interface {
	// GenerateSessionSubject generates a human-readable subject for the session
	// associated with the given execution and updates it in the database.
	//
	// executionID: The AgentExecution ID used to hydrate session/agent context.
	GenerateSessionSubject(executionID string) error
}

// GenerateSessionSubjectActivityName is the activity name used for registration.
// This MUST match the TypeScript runner's registration key exactly for polyglot to work.
const GenerateSessionSubjectActivityName = "GenerateSessionSubject"

// NewGenerateSessionSubjectActivityStub creates an activity stub for calling
// GenerateSessionSubject from workflows. Configured for best-effort execution:
// a single attempt with a 60 s deadline, matching the Java workflow's policy.
func NewGenerateSessionSubjectActivityStub(ctx workflow.Context, taskQueue string) GenerateSessionSubjectActivity {
	options := workflow.ActivityOptions{
		TaskQueue:              taskQueue, // Route to the unified runner worker (from memo)
		StartToCloseTimeout:    60 * time.Second,
		ScheduleToStartTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 1, // Best-effort — a failure should not retry
		},
	}

	ctx = workflow.WithActivityOptions(ctx, options)

	return &generateSessionSubjectActivityStub{ctx: ctx}
}

// generateSessionSubjectActivityStub is the internal stub implementation.
type generateSessionSubjectActivityStub struct {
	ctx workflow.Context
}

func (s *generateSessionSubjectActivityStub) GenerateSessionSubject(executionID string) error {
	return workflow.ExecuteActivity(s.ctx, GenerateSessionSubjectActivityName, executionID).Get(s.ctx, nil)
}

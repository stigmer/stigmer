package activities

import (
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// ExecuteCursorActivity is the interface for executing Cursor harness agents.
//
// This activity is implemented in TypeScript (unified runner) and:
// 1. Fetches AgentExecution from database via gRPC get(executionID)
// 2. Resolves or creates a Cursor Agent (Agent.create / Agent.resume)
// 3. Writes HITL hooks to the workspace
// 4. Sends the prompt via agent.send() and streams events
// 5. Sends progressive status updates to DB via gRPC during execution
// 6. Returns a slim status summary to the workflow
//
// The Cursor harness uses the same slim-payload and HITL patterns as DeepAgent:
// - Input: executionID + threadID (Cursor agentId, empty on first execution)
// - Output: slim AgentExecutionStatus (phase, pending_approvals, error, timestamps)
// - HITL: hook-deny + workflow reinvoke (same approvalGateResolved signal)
//
// threadID stores the Cursor agentId. On the first execution, the activity
// creates a Cursor Agent, stores its agentId as session.spec.thread_id, and
// returns. The workflow reads it back via ReadSessionThreadId on reinvocation.
//
// Unified Runner Architecture:
// Both ExecuteCursor and ExecuteDeepAgent are registered on the same activity
// task queue (global: agent_execution_runner, or per-session: session:{id}).
// Temporal routes by activity name — no queue suffix is needed. The workflow
// dispatches to the correct activity based on session.spec.harness.
type ExecuteCursorActivity interface {
	ExecuteCursor(executionID string, threadID string) (*agentexecutionv1.AgentExecutionStatus, error)
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

func (s *executeCursorActivityStub) ExecuteCursor(executionID string, threadID string) (*agentexecutionv1.AgentExecutionStatus, error) {
	var result *agentexecutionv1.AgentExecutionStatus
	err := workflow.ExecuteActivity(s.ctx, ExecuteCursorActivityName, executionID, threadID).Get(s.ctx, &result)
	return result, err
}

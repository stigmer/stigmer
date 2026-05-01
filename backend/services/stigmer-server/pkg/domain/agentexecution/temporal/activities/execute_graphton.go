package activities

import (
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// ExecuteGraphtonActivity is the interface for executing Graphton agents.
//
// This activity is implemented in Python (agent-runner) and:
// 1. Fetches AgentExecution from database via gRPC get(executionID)
// 2. Fetches Agent configuration via gRPC chain resolution
// 3. Creates Graphton agent at runtime using create_deep_agent()
// 4. Invokes agent with thread_id for state persistence
// 5. Sends progressive status updates to DB via gRPC during execution
// 6. Returns a slim status summary to the workflow
//
// Slim-Payload Pattern (Input + Output):
// Input:  The activity receives only an executionID (not the full AgentExecution
//
//	proto) and hydrates it from the database.
//
// Output: The activity returns a slim AgentExecutionStatus containing only
//
//	workflow-critical fields: phase, pending_approvals, error, usage,
//	started_at, and completed_at.  Heavy fields (messages, tool_calls,
//	sub_agent_executions, todos, artifacts, context_info) are omitted
//	because they are already persisted to the database via progressive
//	gRPC updates during execution.
//
// This keeps both input and output payloads well under Temporal's ~2 MB limit.
//
// Polyglot Pattern:
// - Python activity sends real-time status to DB via gRPC
// - Returns slim summary to workflow for orchestration decisions
//
// Graphton agents support thread-based state persistence via LangGraph.
type ExecuteGraphtonActivity interface {
	// ExecuteGraphton executes a Graphton agent and returns a slim status summary.
	//
	// The returned AgentExecutionStatus contains only workflow-critical fields
	// (phase, pending_approvals, error, usage, timestamps).  Heavy fields like
	// messages and tool_calls are already in the database from progressive gRPC
	// updates sent during execution and are intentionally omitted to stay under
	// Temporal's payload size limit.
	//
	// HITL approval decisions are read from the database by the Python activity
	// (DB-driven resume). No decisions are passed via Temporal arguments.
	//
	// executionID: The AgentExecution ID to fetch and execute
	// threadID: The LangGraph thread ID for conversation state persistence
	//
	// Returns: Slim execution status (phase, pending_approvals, error, usage).
	ExecuteGraphton(executionID string, threadID string) (*agentexecutionv1.AgentExecutionStatus, error)
}

// ExecuteGraphtonActivityName is the activity name used for registration.
// This MUST match the Python activity name exactly for polyglot to work.
const ExecuteGraphtonActivityName = "ExecuteGraphton"

// NewExecuteGraphtonActivityStub creates an activity stub for calling ExecuteGraphton from workflows.
// This is used by workflow implementations to call the Python activity.
func NewExecuteGraphtonActivityStub(ctx workflow.Context, taskQueue string) ExecuteGraphtonActivity {
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

	return &executeGraphtonActivityStub{ctx: ctx}
}

// executeGraphtonActivityStub is the internal stub implementation.
type executeGraphtonActivityStub struct {
	ctx workflow.Context
}

func (s *executeGraphtonActivityStub) ExecuteGraphton(executionID string, threadID string) (*agentexecutionv1.AgentExecutionStatus, error) {
	var result *agentexecutionv1.AgentExecutionStatus
	err := workflow.ExecuteActivity(s.ctx, ExecuteGraphtonActivityName, executionID, threadID).Get(s.ctx, &result)
	return result, err
}

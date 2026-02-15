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
// 5. Builds status locally during execution (messages, tool_calls, phase)
// 6. Returns final status to workflow for observability
//
// Slim-Payload Pattern:
// The activity receives only an executionID (not the full AgentExecution proto)
// and hydrates it from the database.  This keeps Temporal activity payloads
// small and bounded, avoiding the ~2 MB payload limit as status grows.
//
// Polyglot Pattern:
// - Python activity builds the status locally
// - Returns status to workflow
// - Workflow calls Go persistence activity (separate task queue)
//
// Graphton agents support thread-based state persistence via LangGraph.
type ExecuteGraphtonActivity interface {
	// ExecuteGraphton executes a Graphton agent and returns final status.
	//
	// Polyglot workflow pattern: Python activity fetches execution from DB,
	// returns status to Go workflow for orchestration.
	//
	// executionID: The AgentExecution ID to fetch and execute
	// threadID: The LangGraph thread ID for conversation state persistence
	// approvalDecisions: Approval decisions for HITL resume (nil on first invocation).
	//   Each entry carries a tool_call_id, action, and optional comment.
	//
	// Returns: Final execution status with messages, tool_calls, phase, etc.
	ExecuteGraphton(executionID string, threadID string, approvalDecisions []*agentexecutionv1.SubmitApprovalInput) (*agentexecutionv1.AgentExecutionStatus, error)
}

// ExecuteGraphtonActivityName is the activity name used for registration.
// This MUST match the Python activity name exactly for polyglot to work.
const ExecuteGraphtonActivityName = "ExecuteGraphton"

// NewExecuteGraphtonActivityStub creates an activity stub for calling ExecuteGraphton from workflows.
// This is used by workflow implementations to call the Python activity.
func NewExecuteGraphtonActivityStub(ctx workflow.Context, taskQueue string) ExecuteGraphtonActivity {
	// Create activity options with explicit task queue routing to Python worker
	options := workflow.ActivityOptions{
		TaskQueue:              taskQueue, // Route to Python worker (from memo)
		StartToCloseTimeout:    10 * time.Minute, // 10 minutes for agent execution
		ScheduleToStartTimeout: 1 * time.Minute,  // Max wait for worker to pick up task
		HeartbeatTimeout:       30 * time.Second,  // Activity must send heartbeat every 30s
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts:    1, // No retries for agent execution (not idempotent)
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

func (s *executeGraphtonActivityStub) ExecuteGraphton(executionID string, threadID string, approvalDecisions []*agentexecutionv1.SubmitApprovalInput) (*agentexecutionv1.AgentExecutionStatus, error) {
	var result *agentexecutionv1.AgentExecutionStatus
	err := workflow.ExecuteActivity(s.ctx, ExecuteGraphtonActivityName, executionID, threadID, approvalDecisions).Get(s.ctx, &result)
	return result, err
}

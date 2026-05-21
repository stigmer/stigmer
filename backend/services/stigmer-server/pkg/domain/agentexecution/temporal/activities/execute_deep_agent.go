package activities

import (
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// ExecuteDeepAgentActivity is the interface for executing native deep agents.
//
// This activity is implemented in TypeScript (unified runner) and:
// 1. Fetches AgentExecution from database via gRPC get(executionID)
// 2. Fetches Agent configuration via gRPC chain resolution
// 3. Creates a deep agent at runtime using createDeepAgent()
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
// Unified Runner Architecture:
// Both ExecuteCursor and ExecuteDeepAgent are registered on the same activity
// task queue (global: agent_execution_runner, or per-session: session:{id}).
// Temporal routes by activity name — no queue suffix is needed. The workflow
// dispatches to the correct activity based on session.spec.harness.
//
// Deep agents support thread-based state persistence via LangGraph.
type ExecuteDeepAgentActivity interface {
	// ExecuteDeepAgent executes a native deep agent and returns a slim status summary.
	//
	// The returned AgentExecutionStatus contains only workflow-critical fields
	// (phase, pending_approvals, error, usage, timestamps).  Heavy fields like
	// messages and tool_calls are already in the database from progressive gRPC
	// updates sent during execution and are intentionally omitted to stay under
	// Temporal's payload size limit.
	//
	// HITL approval decisions are read from the database by the activity
	// (DB-driven resume). No decisions are passed via Temporal arguments.
	//
	// executionID: The AgentExecution ID to fetch and execute
	// threadID: The LangGraph thread ID for conversation state persistence
	//
	// Returns: Slim execution status (phase, pending_approvals, error, usage).
	ExecuteDeepAgent(executionID string, threadID string) (*agentexecutionv1.AgentExecutionStatus, error)
}

// ExecuteDeepAgentActivityName is the activity name used for Temporal registration.
// This MUST match the TypeScript unified runner activity name exactly.
const ExecuteDeepAgentActivityName = "ExecuteDeepAgent"

// NewExecuteDeepAgentActivityStub creates an activity stub for calling ExecuteDeepAgent from workflows.
func NewExecuteDeepAgentActivityStub(ctx workflow.Context, taskQueue string) ExecuteDeepAgentActivity {
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

	return &executeDeepAgentActivityStub{ctx: ctx}
}

type executeDeepAgentActivityStub struct {
	ctx workflow.Context
}

func (s *executeDeepAgentActivityStub) ExecuteDeepAgent(executionID string, threadID string) (*agentexecutionv1.AgentExecutionStatus, error) {
	var result *agentexecutionv1.AgentExecutionStatus
	err := workflow.ExecuteActivity(s.ctx, ExecuteDeepAgentActivityName, executionID, threadID).Get(s.ctx, &result)
	return result, err
}

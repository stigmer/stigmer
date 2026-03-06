package workflows

import (
	"go.temporal.io/sdk/workflow"
)

// InvokeAgentExecutionWorkflow is the interface for the agent execution workflow.
//
// Orchestrates the execution of an agent by calling Graphton agents at runtime,
// and streaming results back to execution status.
type InvokeAgentExecutionWorkflow interface {
	// Run invokes an agent execution (Graphton agent creation).
	//
	// input: Slim orchestration coordinates (execution_id, session_id, agent_id,
	// callback_token). Secrets and large payloads are excluded -- they live in
	// the ExecutionContext and the persisted AgentExecution, respectively.
	Run(ctx workflow.Context, input *InvokeAgentExecutionWorkflowInput) error
}

// InvokeAgentExecutionWorkflowName is the workflow name used for registration.
// This MUST match the workflow name in the Java implementation for consistency.
const InvokeAgentExecutionWorkflowName = "stigmer/agent-execution/invoke"

package workflows

import (
	"go.temporal.io/sdk/workflow"
)

// InvokeAgentExecutionWorkflow is the interface for the agent execution workflow.
//
// Orchestrates the execution of an agent by dispatching harness activities
// (ExecuteDeepAgent / ExecuteCursor) to the TS unified runner, and streaming
// results back to execution status.
type InvokeAgentExecutionWorkflow interface {
	// Run invokes an agent execution.
	//
	// input: Slim orchestration coordinates (execution_id, session_id, agent_id,
	// callback_token). Secrets and large payloads are excluded -- they live in
	// the ExecutionContext and the persisted AgentExecution, respectively.
	Run(ctx workflow.Context, input *InvokeAgentExecutionWorkflowInput) error
}

// InvokeAgentExecutionWorkflowName is the workflow name used for registration.
// This MUST match the workflow name in the Java implementation for consistency.
const InvokeAgentExecutionWorkflowName = "stigmer/agent-execution/invoke"

// Signal names for pause/resume lifecycle. These MUST match the signal names
// used by the Java workflow's @SignalMethod declarations and the Go/Java
// RPC handlers that send them (lifecycle_steps.go / AgentExecutionPauseHandler).
const (
	SignalPause  = "pause"
	SignalResume = "resume"
)

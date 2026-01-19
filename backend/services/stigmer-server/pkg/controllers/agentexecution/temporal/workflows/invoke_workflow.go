package workflows

import (
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"go.temporal.io/sdk/workflow"
)

// InvokeAgentExecutionWorkflow is the interface for the agent execution workflow.
//
// Orchestrates the execution of an agent by calling Graphton agents at runtime,
// and streaming results back to execution status.
type InvokeAgentExecutionWorkflow interface {
	// Run invokes an agent execution (Graphton agent creation).
	//
	// execution: The execution resource containing spec (agent_id, session_id, message)
	Run(ctx workflow.Context, execution *agentexecutionv1.AgentExecution) error
}

// InvokeAgentExecutionWorkflowName is the workflow name used for registration.
// This MUST match the workflow name in the Java implementation for consistency.
const InvokeAgentExecutionWorkflowName = "stigmer/agent-execution/invoke"

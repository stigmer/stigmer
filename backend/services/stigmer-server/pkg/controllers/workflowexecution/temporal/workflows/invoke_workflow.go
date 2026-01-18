package workflows

import (
	workflowexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflowexecution/v1"
	"go.temporal.io/sdk/workflow"
)

// InvokeWorkflowExecutionWorkflow is the interface for the workflow execution workflow.
//
// Orchestrates the execution of a workflow by calling Zigflow at runtime,
// and streaming results back to execution status.
type InvokeWorkflowExecutionWorkflow interface {
	// Run invokes a workflow execution (Zigflow workflow creation).
	//
	// execution: The execution resource containing spec (workflow_instance_id, trigger data)
	Run(ctx workflow.Context, execution *workflowexecutionv1.WorkflowExecution) error
}

// InvokeWorkflowExecutionWorkflowName is the workflow name used for registration.
// This MUST match the workflow name in the Java implementation for consistency.
const InvokeWorkflowExecutionWorkflowName = "stigmer/workflow-execution/invoke"

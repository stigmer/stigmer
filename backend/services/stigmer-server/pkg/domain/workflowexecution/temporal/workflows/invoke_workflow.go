package workflows

import (
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/activities"
	"go.temporal.io/sdk/workflow"
)

// InvokeWorkflowExecutionWorkflow is the interface for the workflow execution workflow.
//
// Orchestrates the execution of a workflow by calling Zigflow at runtime,
// and streaming results back to execution status.
type InvokeWorkflowExecutionWorkflow interface {
	// Run invokes a workflow execution (Zigflow workflow creation).
	//
	// input: Slim orchestration coordinates (execution_id, workflow_instance_id,
	// workflow_id, org_id, callback_token, invoker_identity_account_id).
	// Secrets and large payloads are excluded — they live in the
	// ExecutionContext and the persisted WorkflowExecution, respectively.
	Run(ctx workflow.Context, input *activities.InvokeWorkflowExecutionWorkflowInput) error
}

// InvokeWorkflowExecutionWorkflowName is the workflow name used for registration.
// This MUST match the workflow name in the Java implementation for consistency.
const InvokeWorkflowExecutionWorkflowName = "stigmer/workflow-execution/invoke"

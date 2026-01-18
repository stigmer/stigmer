package temporal

// Constants for workflow execution Temporal workflow types and task queues.

const (
	// WorkflowExecutionInvoke is the workflow type for executing workflows (Zigflow).
	// Workflow ID format: stigmer/workflow-execution/invoke/{execution-id}
	WorkflowExecutionInvoke = "stigmer/workflow-execution/invoke"

	// DefaultWorkflowExecutionTaskQueue is the default task queue for workflow execution activities.
	// Used when environment variables are not set.
	DefaultWorkflowExecutionTaskQueue = "workflow_execution"
)

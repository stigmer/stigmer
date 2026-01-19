package temporal

// Constants for workflow validation Temporal workflow types and task queues.
const (
	// WorkflowValidationWorkflowType is the workflow type for validating serverless workflows.
	// Workflow ID format: stigmer/workflow-validation/{uuid}
	WorkflowValidationWorkflowType = "ValidateWorkflow"

	// WorkflowValidationTaskQueue is the default task queue for workflow validation.
	// This is used when queue names are not specified via environment variables.
	WorkflowValidationTaskQueue = "workflow_validation"
)

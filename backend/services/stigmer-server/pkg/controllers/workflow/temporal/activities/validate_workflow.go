package activities

import (
	workflowv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflow/v1"
	serverlessv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflow/v1/serverless"
)

// ValidateWorkflowActivity is the interface for the workflow validation activity.
//
// Implementation: Go (workflow-runner)
// Task Queue: workflow_validation_runner
//
// The activity:
// 1. Converts WorkflowSpec proto → Serverless Workflow YAML
// 2. Validates YAML structure using Zigflow parser
// 3. Returns ServerlessWorkflowValidation with state (VALID/INVALID/FAILED)
//
// This follows the polyglot pattern where:
// - Go defines the interface (contract)
// - Go implements the activity (execution in workflow-runner)
// - Activity name matches method name: "validateWorkflow"
type ValidateWorkflowActivity interface {
	// ValidateWorkflow validates a workflow spec.
	//
	// Activity Implementation (Go workflow-runner):
	// 1. Generate YAML from WorkflowSpec proto
	// 2. Validate YAML structure using Zigflow
	// 3. Return validation result with state, errors, warnings
	//
	// Returns validation result (never null - always returns a state)
	ValidateWorkflow(spec *workflowv1.WorkflowSpec) (*serverlessv1.ServerlessWorkflowValidation, error)
}

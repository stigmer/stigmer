package temporal

import (
	"time"

	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	serverlessv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/serverless"
)

// ValidateWorkflowWorkflow is the Temporal workflow interface for validating serverless workflows.
//
// Polyglot Workflow Pattern:
// - Workflow (Go): Thin orchestration - calls activity
// - Activity (Go): ValidateWorkflow - all validation logic (in workflow-runner)
//
// The workflow calls ONE Go activity that:
// 1. Generates YAML from WorkflowSpec proto
// 2. Validates YAML structure using Zigflow parser
// 3. Returns ServerlessWorkflowValidation with state (VALID/INVALID/FAILED)
//
// This workflow is called synchronously during workflow creation.
// It validates the workflow structure before persisting to BadgerDB.
type ValidateWorkflowWorkflow func(ctx workflow.Context, spec *workflowv1.WorkflowSpec) (*serverlessv1.ServerlessWorkflowValidation, error)

// ValidateWorkflowWorkflowImpl implements the ValidateWorkflowWorkflow.
//
// Polyglot Workflow Pattern (following InvokeWorkflowExecutionWorkflow pattern):
// - Go Workflow (this): Thin orchestration - calls activity, returns result
// - Go Activity (workflow-runner): ValidateWorkflow - all validation logic
//
// Activity Flow:
// 1. ValidateWorkflow (Go): Generates YAML + validates structure using Zigflow
// 2. Returns ServerlessWorkflowValidation directly
//
// Design Principle:
// - Workflow = Thin orchestration (NO business logic)
// - Activity = All validation logic (YAML generation + Zigflow validation)
// - NO error handling in workflow - activity returns validation state (VALID/INVALID/FAILED)
//
// Performance:
// - Expected latency: 50-200ms
// - Timeout: 30 seconds (generous)
func ValidateWorkflowWorkflowImpl(ctx workflow.Context, spec *workflowv1.WorkflowSpec) (*serverlessv1.ServerlessWorkflowValidation, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting serverless workflow validation")

	// Get activity task queue from workflow memo
	// This allows configurable task queues for polyglot setup
	activityTaskQueue := getActivityTaskQueue(ctx)

	// Configure activity options
	// IMPORTANT: Task queue for activities is configured via workflow memo
	// Go workflow runs on "workflow_validation_stigmer" (or configured value)
	// Go activities run on "workflow_validation_runner" (or configured value)
	// This allows environment-specific configuration through environment variables
	activityOptions := workflow.ActivityOptions{
		TaskQueue:           activityTaskQueue, // Route to workflow-runner (from memo)
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
			InitialInterval: 1 * time.Second,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Call Go activity - all validation logic is in the activity
	// Activity handles:
	// 1. Convert WorkflowSpec proto → YAML
	// 2. Validate YAML structure using Zigflow
	// 3. Return ServerlessWorkflowValidation with state (VALID/INVALID/FAILED)
	var result serverlessv1.ServerlessWorkflowValidation
	err := workflow.ExecuteActivity(ctx, "validateWorkflow", spec).Get(ctx, &result)
	if err != nil {
		logger.Error("Validation activity failed", "error", err)
		return nil, err
	}

	logger.Info("Validation completed",
		"state", result.State,
		"errors", len(result.Errors),
		"warnings", len(result.Warnings))

	return &result, nil
}

// getActivityTaskQueue gets the activity task queue from workflow memo.
// This allows configurable task queues for polyglot setup.
//
// Returns: Activity task queue name (defaults to "workflow_validation_runner")
func getActivityTaskQueue(ctx workflow.Context) string {
	info := workflow.GetInfo(ctx)
	// Access memo fields directly
	if info.Memo != nil && info.Memo.Fields != nil {
		if taskQueueField, ok := info.Memo.Fields["activityTaskQueue"]; ok {
			var taskQueueStr string
			if err := converter.GetDefaultDataConverter().FromPayload(taskQueueField, &taskQueueStr); err == nil && taskQueueStr != "" {
				return taskQueueStr
			}
		}
	}
	// Default fallback (should never happen if workflow is created properly)
	return "workflow_validation_runner"
}

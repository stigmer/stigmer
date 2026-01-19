package workflows

import (
	"fmt"
	"time"

	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/activities"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// InvokeWorkflowExecutionWorkflowImpl implements InvokeWorkflowExecutionWorkflow.
//
// Polyglot Workflow Pattern:
// - Workflow (Go): Orchestrates activity execution
// - Go Activities (workflow-runner): ExecuteWorkflow (on "runner" queue)
//
// The workflow:
// 1. Executes Zigflow workflow (Go activity)
//    - During execution, workflow-runner sends progressive status updates via gRPC
//    - Updates are processed by WorkflowExecutionUpdateHandler (custom status merge logic)
//    - Final status is returned to workflow for observability
//
// Status Update Strategy:
// - Real-time updates: gRPC calls from Go activity to stigmer-server
// - Final state: Returned to workflow (for Temporal observability)
//
// Agent-Runner Pattern (Phases 1-3.5):
// - Go workflow passes execution_id only (via WorkflowExecution proto)
// - Go activity queries Stigmer service for WorkflowExecution → WorkflowInstance → Workflow
// - Converts WorkflowSpec proto → YAML using Phase 2 converter
// - Executes via Zigflow engine
// - Reports progressive status via gRPC callbacks
type InvokeWorkflowExecutionWorkflowImpl struct{}

// Run implements InvokeWorkflowExecutionWorkflow.Run
func (w *InvokeWorkflowExecutionWorkflowImpl) Run(ctx workflow.Context, execution *workflowexecutionv1.WorkflowExecution) error {
	logger := workflow.GetLogger(ctx)
	executionID := execution.GetMetadata().GetId()

	logger.Info("Starting workflow for execution", "execution_id", executionID)

	// Execute the Zigflow workflow flow
	if err := w.executeWorkflowFlow(ctx, execution); err != nil {
		logger.Error("❌ Workflow execution failed", "execution_id", executionID, "error", err.Error())

		// Update execution status to FAILED with error details
		// This handles system errors (workflow type not found, activity registration, etc.)
		if err := w.updateStatusOnFailure(ctx, executionID, err); err != nil {
			logger.Error("❌ Failed to update execution status", "error", err.Error())
			// Continue to return original error even if status update fails
		}

		return temporal.NewApplicationError("Workflow execution failed", "", err)
	}

	logger.Info("✅ Workflow completed for execution (status updates were sent progressively via gRPC)", "execution_id", executionID)
	return nil
}

// executeWorkflowFlow executes the Zigflow workflow via polyglot Go activity.
//
// Orchestrates:
// 1. Go activity: Execute workflow (on "runner" queue)
//    - Queries Stigmer for WorkflowExecution → WorkflowInstance → Workflow
//    - Converts WorkflowSpec proto → YAML (Phase 2 converter)
//    - Executes via Zigflow engine
//    - Sends progressive status updates via gRPC
//    - Returns final status for Temporal observability
func (w *InvokeWorkflowExecutionWorkflowImpl) executeWorkflowFlow(ctx workflow.Context, execution *workflowexecutionv1.WorkflowExecution) error {
	logger := workflow.GetLogger(ctx)

	executionID := execution.GetMetadata().GetId()
	workflowInstanceID := execution.GetSpec().GetWorkflowInstanceId()

	logger.Info("Starting workflow execution", "execution_id", executionID, "instance_id", workflowInstanceID)

	// Get activity task queue from workflow memo
	activityTaskQueue := w.getActivityTaskQueue(ctx)

	// Execute Zigflow workflow (Go activity)
	// Go activity:
	// - Queries Stigmer service for full context (execution → instance → workflow)
	// - Converts WorkflowSpec proto → YAML (Phase 2 converter)
	// - Executes via Zigflow and processes events
	// - Sends progressive status updates via gRPC (real-time)
	// - Returns final status to workflow (for observability)
	logger.Info("Executing Zigflow workflow", "execution_id", executionID)
	logger.Info("workflow-runner will send progressive status updates via gRPC during execution")

	executeWorkflowActivity := activities.NewExecuteWorkflowActivityStub(ctx, activityTaskQueue)
	finalStatus, err := executeWorkflowActivity.ExecuteWorkflow(execution)
	if err != nil {
		return fmt.Errorf("failed to execute workflow: %w", err)
	}

	// Defensive null check
	if finalStatus == nil {
		logger.Error("❌ ExecuteWorkflow returned NULL status", "execution_id", executionID)
		return fmt.Errorf("go activity returned null status - this should never happen")
	}

	logger.Info("✅ Zigflow execution completed - final status received",
		"tasks", len(finalStatus.GetTasks()),
		"phase", finalStatus.GetPhase().String())

	return nil
}

// getActivityTaskQueue retrieves the activity task queue from workflow memo.
// This allows configurable task queues for polyglot setup.
//
// Returns: Activity task queue name (defaults to "workflow_execution_runner")
func (w *InvokeWorkflowExecutionWorkflowImpl) getActivityTaskQueue(ctx workflow.Context) string {
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
	return "workflow_execution_runner"
}

// updateStatusOnFailure updates the execution status to FAILED when a system error occurs.
func (w *InvokeWorkflowExecutionWorkflowImpl) updateStatusOnFailure(ctx workflow.Context, executionID string, originalErr error) error {
	logger := workflow.GetLogger(ctx)

	logger.Info("Updating execution status to FAILED", "execution_id", executionID)

	// Create failed status with error details
	// Only set phase and error - don't create artificial tasks
	failedStatus := &workflowexecutionv1.WorkflowExecutionStatus{
		Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED,
		Error: fmt.Sprintf("Workflow execution failed: %s", originalErr.Error()),
	}

	// Create local activity stub for status update (runs in-process)
	// Local activities don't go through Temporal task queues, avoiding polyglot collision
	localCtx := workflow.WithLocalActivityOptions(ctx, workflow.LocalActivityOptions{
		ScheduleToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
			InitialInterval: 2 * time.Second,
		},
	})

	// Call the update status activity (this should be registered as a local activity)
	err := workflow.ExecuteLocalActivity(localCtx, activities.UpdateWorkflowExecutionStatusActivityName, executionID, failedStatus).Get(localCtx, nil)
	if err != nil {
		logger.Error("Failed to update execution status", "error", err.Error())
		return err
	}

	logger.Info("✅ Updated execution status to FAILED", "execution_id", executionID)
	return nil
}

package workflows

import (
	"fmt"
	"time"

	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/controllers/agentexecution/temporal/activities"
	agentexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentexecution/v1"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// InvokeAgentExecutionWorkflowImpl implements InvokeAgentExecutionWorkflow.
//
// Polyglot Workflow Pattern:
// - Workflow (Go): Orchestrates activity execution
// - Python Activities (agent-runner): ExecuteGraphton, EnsureThread (on "execution" queue)
//
// The workflow:
// 1. Ensures thread exists for conversation state (Python activity)
// 2. Executes Graphton agent (Python activity)
//    - During execution, agent-runner sends progressive status updates via gRPC
//    - Updates are processed by AgentExecutionUpdateHandler (custom status merge logic)
//    - Final status is returned to workflow for observability
//
// Status Update Strategy:
// - Real-time updates: gRPC calls from Python activity to stigmer-server
// - Final state: Returned to workflow (for Temporal observability)
type InvokeAgentExecutionWorkflowImpl struct{}

// Run implements InvokeAgentExecutionWorkflow.Run
func (w *InvokeAgentExecutionWorkflowImpl) Run(ctx workflow.Context, execution *agentexecutionv1.AgentExecution) error {
	logger := workflow.GetLogger(ctx)
	executionID := execution.GetMetadata().GetId()

	logger.Info("Starting workflow for execution", "execution_id", executionID)

	// Execute the Graphton flow
	if err := w.executeGraphtonFlow(ctx, execution); err != nil {
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

// executeGraphtonFlow executes the Graphton agent flow with polyglot activities.
//
// Orchestrates:
// 1. Python activity: Ensure thread (on "execution" queue)
// 2. Python activity: Execute agent (on "execution" queue)
//    - During execution, agent-runner sends progressive status updates via gRPC
//    - Final status is returned for Temporal observability
func (w *InvokeAgentExecutionWorkflowImpl) executeGraphtonFlow(ctx workflow.Context, execution *agentexecutionv1.AgentExecution) error {
	logger := workflow.GetLogger(ctx)

	sessionID := execution.GetSpec().GetSessionId()
	agentID := execution.GetSpec().GetAgentId()
	executionID := execution.GetMetadata().GetId()

	// Get activity task queue from workflow memo
	activityTaskQueue := w.getActivityTaskQueue(ctx)

	// Step 1: Ensure thread exists (Python activity)
	logger.Info("Step 1: Ensuring thread", "session_id", sessionID, "agent_id", agentID)

	ensureThreadActivity := activities.NewEnsureThreadActivityStub(ctx, activityTaskQueue)
	threadID, err := ensureThreadActivity.EnsureThread(sessionID, agentID)
	if err != nil {
		return fmt.Errorf("failed to ensure thread: %w", err)
	}

	logger.Info("✅ Thread ensured", "thread_id", threadID)

	// Step 2: Execute Graphton with thread_id (Python activity)
	// Python activity:
	// - Executes agent and processes events
	// - Sends progressive status updates via gRPC (real-time)
	// - Returns final status to workflow (for observability)
	logger.Info("Step 2: Executing Graphton agent", "execution_id", executionID, "thread_id", threadID)
	logger.Info("Agent-runner will send progressive status updates via gRPC during execution")

	executeGraphtonActivity := activities.NewExecuteGraphtonActivityStub(ctx, activityTaskQueue)
	finalStatus, err := executeGraphtonActivity.ExecuteGraphton(execution, threadID)
	if err != nil {
		return fmt.Errorf("failed to execute graphton: %w", err)
	}

	// Defensive null check
	if finalStatus == nil {
		logger.Error("❌ ExecuteGraphton returned NULL status", "execution_id", executionID)
		return fmt.Errorf("python activity returned null status - this should never happen")
	}

	logger.Info("✅ Graphton execution completed - final status received",
		"messages", len(finalStatus.GetMessages()),
		"tool_calls", len(finalStatus.GetToolCalls()),
		"phase", finalStatus.GetPhase().String())

	return nil
}

// getActivityTaskQueue retrieves the activity task queue from workflow memo.
// This allows configurable task queues for polyglot setup.
//
// Returns: Activity task queue name (defaults to "agent_execution_runner")
func (w *InvokeAgentExecutionWorkflowImpl) getActivityTaskQueue(ctx workflow.Context) string {
	info := workflow.GetInfo(ctx)

	// Try to get from memo
	if taskQueue, ok := info.Memo.GetValue("activityTaskQueue"); ok {
		var taskQueueStr string
		if err := taskQueue.Get(&taskQueueStr); err == nil && taskQueueStr != "" {
			return taskQueueStr
		}
	}

	// Default fallback (should never happen if workflow is created properly)
	return "agent_execution_runner"
}

// updateStatusOnFailure updates the execution status to FAILED when a system error occurs.
func (w *InvokeAgentExecutionWorkflowImpl) updateStatusOnFailure(ctx workflow.Context, executionID string, originalErr error) error {
	logger := workflow.GetLogger(ctx)

	logger.Info("Updating execution status to FAILED", "execution_id", executionID)

	// Create failed status with error details
	failedStatus := &agentexecutionv1.AgentExecutionStatus{
		Phase: agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
		Messages: []*agentexecutionv1.AgentMessage{
			{
				Type:    agentexecutionv1.MessageType_MESSAGE_SYSTEM,
				Content: "Internal system error occurred during execution. Please contact support if this issue persists.",
			},
			{
				Type:    agentexecutionv1.MessageType_MESSAGE_SYSTEM,
				Content: fmt.Sprintf("Error details: %s", originalErr.Error()),
			},
		},
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
	err := workflow.ExecuteLocalActivity(localCtx, activities.UpdateExecutionStatusActivityName, executionID, failedStatus).Get(localCtx, nil)
	if err != nil {
		logger.Error("Failed to update execution status", "error", err.Error())
		return err
	}

	logger.Info("✅ Updated execution status to FAILED", "execution_id", executionID)
	return nil
}

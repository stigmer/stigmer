package workflows

import (
	"errors"
	"fmt"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal/activities"
	"go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/converter"
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
//   - During execution, agent-runner sends progressive status updates via gRPC
//   - Updates are processed by AgentExecutionUpdateHandler (custom status merge logic)
//   - Final status is returned to workflow for observability
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

	// Log callback token presence (for async activity completion pattern)
	// See: docs/adr/20260122-async-agent-execution-temporal-token-handshake.md
	callbackToken := execution.GetSpec().GetCallbackToken()
	if len(callbackToken) > 0 {
		logger.Info("📝 Callback token detected - will complete external activity on finish",
			"execution_id", executionID,
			"token_length", len(callbackToken))
	}

	// Execute the Graphton flow
	if err := w.executeGraphtonFlow(ctx, execution); err != nil {
		logger.Error("❌ Workflow execution failed", "execution_id", executionID, "error", err.Error())

		// Update execution status to FAILED with error details
		// This handles system errors (workflow type not found, activity registration, etc.)
		if err := w.updateStatusOnFailure(ctx, executionID, err); err != nil {
			logger.Error("❌ Failed to update execution status", "error", err.Error())
			// Continue to return original error even if status update fails
		}

		// Complete external activity with error (if token provided)
		if len(callbackToken) > 0 {
			if err := w.completeExternalActivity(ctx, callbackToken, nil, err); err != nil {
				logger.Error("❌ Failed to complete external activity with error", "error", err.Error())
				// Continue to return original error even if completion fails
			}
		}

		return temporal.NewApplicationError("Workflow execution failed", "", err)
	}

	logger.Info("✅ Workflow completed for execution (status updates were sent progressively via gRPC)", "execution_id", executionID)

	// Complete external activity with success (if token provided)
	if len(callbackToken) > 0 {
		// Return the execution as the result
		if err := w.completeExternalActivity(ctx, callbackToken, execution, nil); err != nil {
			logger.Error("❌ Failed to complete external activity with success", "error", err.Error())
			return err
		}
	}

	return nil
}

// executeGraphtonFlow executes the Graphton agent flow with polyglot activities.
//
// Orchestrates:
// 1. Python activity: Ensure thread (on "execution" queue)
// 2. Python activity: Execute agent (on "execution" queue)
//   - During execution, agent-runner sends progressive status updates via gRPC
//   - Final status is returned for Temporal observability
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
		return w.wrapActivityError("EnsureThread", err)
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
		return w.wrapActivityError("ExecuteGraphton", err)
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

// wrapActivityError wraps activity errors with helpful context for troubleshooting.
//
// This helps distinguish between different failure types:
// - Worker not available (SCHEDULE_TO_START timeout)
// - Worker startup failure (SCHEDULE_TO_START timeout with no heartbeat)
// - Activity execution timeout (START_TO_CLOSE timeout)
// - Activity heartbeat timeout (worker died mid-execution)
// - Activity failure (application error from Python)
func (w *InvokeAgentExecutionWorkflowImpl) wrapActivityError(activityName string, err error) error {
	// Check error type to provide helpful context
	errorMsg := err.Error()

	// Check for TimeoutError and examine timeout type
	var timeoutErr *temporal.TimeoutError
	if errors.As(err, &timeoutErr) {
		switch timeoutErr.TimeoutType() {
		case enums.TIMEOUT_TYPE_SCHEDULE_TO_START:
			// SCHEDULE_TO_START timeout: Worker not available or failed to start
			return fmt.Errorf(
				"activity '%s' failed: No worker available to execute activity. "+
					"This usually means:\n"+
					"1. agent-runner service is not running\n"+
					"2. agent-runner failed to start (check agent-runner logs for startup errors like import failures)\n"+
					"3. agent-runner is not connected to Temporal\n"+
					"Original error: %w",
				activityName, err,
			)
		case enums.TIMEOUT_TYPE_HEARTBEAT:
			// HEARTBEAT timeout: Worker died or stopped sending progress
			return fmt.Errorf(
				"activity '%s' failed: Activity stopped sending heartbeat (worker may have crashed). "+
					"Check agent-runner logs for errors. "+
					"Original error: %w",
				activityName, err,
			)
		case enums.TIMEOUT_TYPE_START_TO_CLOSE:
			// START_TO_CLOSE timeout: Activity took too long
			return fmt.Errorf(
				"activity '%s' failed: Activity execution timed out. "+
					"The activity started but did not complete within the timeout period. "+
					"Check agent-runner logs for details. "+
					"Original error: %w",
				activityName, err,
			)
		default:
			// Other timeout types
			return fmt.Errorf(
				"activity '%s' failed with timeout (type: %s). "+
					"Check agent-runner logs for details. "+
					"Original error: %w",
				activityName, timeoutErr.TimeoutType().String(), err,
			)
		}
	}

	// Application error: Activity failed with an error from Python
	if temporal.IsApplicationError(err) {
		return fmt.Errorf(
			"activity '%s' failed with application error: %w. "+
				"Check agent-runner logs for detailed error information.",
			activityName, err,
		)
	}

	// Generic error (includes retryable errors, canceled errors, etc.)
	return fmt.Errorf(
		"activity '%s' failed: %s. "+
			"Check agent-runner logs for details. "+
			"Original error: %w",
		activityName, errorMsg, err,
	)
}

// getActivityTaskQueue retrieves the activity task queue from workflow memo.
// This allows configurable task queues for polyglot setup.
//
// Returns: Activity task queue name (defaults to "agent_execution_runner")
func (w *InvokeAgentExecutionWorkflowImpl) getActivityTaskQueue(ctx workflow.Context) string {
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

// completeExternalActivity completes an external Temporal activity using the callback token.
//
// This implements the async activity completion pattern where an external workflow
// (e.g., Zigflow) passes its activity token to this workflow and waits for completion.
//
// See: docs/adr/20260122-async-agent-execution-temporal-token-handshake.md
//
// Parameters:
// - callbackToken: The Temporal task token from the external activity
// - result: The result to return (nil if error is provided)
// - err: The error to return (nil if result is provided)
//
// This method delegates to a system activity (CompleteExternalActivity) because
// workflow code must be deterministic and cannot make external API calls directly.
func (w *InvokeAgentExecutionWorkflowImpl) completeExternalActivity(
	ctx workflow.Context,
	callbackToken []byte,
	result interface{},
	err error,
) error {
	logger := workflow.GetLogger(ctx)

	if len(callbackToken) == 0 {
		logger.Warn("⚠️ completeExternalActivity called with empty token - skipping")
		return nil
	}

	logger.Info("📞 Completing external activity via system activity",
		"token_length", len(callbackToken),
		"has_result", result != nil,
		"has_error", err != nil)

	// Create activity options with appropriate timeouts
	activityCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 1 * time.Minute, // System activity should be fast
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
			InitialInterval: 1 * time.Second,
		},
	})

	// Call the system activity to complete the external activity
	input := &activities.CompleteExternalActivityInput{
		CallbackToken: callbackToken,
		Result:        result,
		Error:         err,
	}

	completionErr := workflow.ExecuteActivity(activityCtx, activities.CompleteExternalActivityName, input).Get(activityCtx, nil)
	if completionErr != nil {
		logger.Error("❌ System activity failed to complete external activity",
			"error", completionErr.Error())
		return completionErr
	}

	logger.Info("✅ External activity completed successfully")
	return nil
}

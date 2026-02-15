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
// 3. If tool requires approval (HITL), waits for submitApproval signal
//   - Signal unblocks the workflow
//   - Workflow re-invokes Python activity with approval decision
//   - Loop continues until execution completes or max approvals reached
//
// Status Update Strategy:
// - Real-time updates: gRPC calls from Python activity to stigmer-server
// - Final state: Returned to workflow (for Temporal observability)
//
// HITL Approval Flow:
// - Python activity returns with EXECUTION_WAITING_FOR_APPROVAL phase
// - Workflow waits for submitApproval signal via Workflow.GetSignalChannel
// - Signal carries SubmitApprovalInput with action (APPROVE/SKIP/REJECT)
// - Workflow embeds decision in execution and re-invokes Python activity
// - Max 100 approval cycles to prevent infinite loops
type InvokeAgentExecutionWorkflowImpl struct {
	// pendingApprovalDecision stores the approval decision received via signal.
	// This field is set by the signal handler and read by the approval loop.
	pendingApprovalDecision *agentexecutionv1.SubmitApprovalInput
}

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

// MaxApprovalCycles is the maximum number of approval iterations to prevent infinite loops.
// Each tool call requiring approval counts as one cycle.
const MaxApprovalCycles = 100

// SignalSubmitApproval is the signal name for approval submissions.
// This must match the constant in temporal/workflow_types.go.
const SignalSubmitApproval = "submitApproval"

// executeGraphtonFlow executes the Graphton agent flow with polyglot activities.
//
// Orchestrates:
// 1. Python activity: Ensure thread (on "execution" queue)
// 2. Python activity: Execute agent (on "execution" queue)
//   - During execution, agent-runner sends progressive status updates via gRPC
//   - Final status is returned for Temporal observability
//
// 3. Approval loop: If tool requires approval, wait for signal and re-invoke
//
// HITL Approval Loop:
// When Python activity returns with EXECUTION_WAITING_FOR_APPROVAL, the workflow:
//   - Waits for submitApproval signal
//   - Embeds the approval decision in the execution
//   - Re-invokes Python activity with the decision
//   - Continues until terminal state or max cycles reached
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

	// Initial execution
	currentExecution := execution
	finalStatus, err := executeGraphtonActivity.ExecuteGraphton(currentExecution, threadID)
	if err != nil {
		return w.wrapActivityError("ExecuteGraphton", err)
	}

	// Defensive null check
	if finalStatus == nil {
		logger.Error("❌ ExecuteGraphton returned NULL status", "execution_id", executionID)
		return fmt.Errorf("python activity returned null status - this should never happen")
	}

	// Step 3: HITL Approval Loop (Batch Approval)
	//
	// When the Python activity returns EXECUTION_WAITING_FOR_APPROVAL, the
	// status may carry one OR more pending_approvals (one per interrupted
	// tool call).  We collect ALL approval signals before re-invoking the
	// activity so that the Python side can construct a single
	//   Command(resume={interrupt_id_A: decision_A, interrupt_id_B: decision_B, ...})
	// and avoid repeated node re-executions.
	//
	// Falls back to single-signal behaviour when pending_approvals is empty
	// (legacy path).
	approvalCycle := 0
	for finalStatus.GetPhase() == agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL {
		approvalCycle++
		if approvalCycle > MaxApprovalCycles {
			logger.Error("❌ Max approval cycles reached", "execution_id", executionID, "cycles", approvalCycle)
			return fmt.Errorf("max approval cycles (%d) reached - possible infinite loop", MaxApprovalCycles)
		}

		pendingApprovals := finalStatus.GetPendingApprovals()
		pendingCount := len(pendingApprovals)

		// Determine how many signals we need to collect in this cycle.
		// One signal per pending approval entry.
		signalsNeeded := pendingCount
		if signalsNeeded == 0 {
			// Safety: if no pending_approvals but phase is WAITING_FOR_APPROVAL,
			// expect at least one signal to unblock.
			signalsNeeded = 1
		}

		// Log a summary of pending approvals for observability
		firstToolCallId := ""
		if pendingCount > 0 {
			firstToolCallId = pendingApprovals[0].GetToolCallId()
		}

		logger.Info("⏳ Execution waiting for approval",
			"execution_id", executionID,
			"cycle", approvalCycle,
			"pending_count", signalsNeeded,
			"first_tool_call", firstToolCallId)

		// Collect all approval signals
		for i := 0; i < signalsNeeded; i++ {
			approvalInput, err := w.waitForApprovalSignal(ctx, executionID)
			if err != nil {
				return err
			}

			logger.Info("✅ Received approval signal",
				"execution_id", executionID,
				"signal_index", i+1,
				"signals_needed", signalsNeeded,
				"tool_call_id", approvalInput.GetToolCallId(),
				"action", approvalInput.GetAction().String())

			// Embed this decision into the execution's tool calls.
			// For REJECT, we short-circuit: the execution is failed, no need
			// to collect more signals.
			currentExecution = w.buildExecutionWithApprovalDecision(ctx, currentExecution, finalStatus, approvalInput)

			if approvalInput.GetAction() == agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT {
				logger.Info("🛑 Tool rejected — skipping remaining approvals",
					"execution_id", executionID,
					"tool_call_id", approvalInput.GetToolCallId())
				break
			}
		}

		// Re-invoke Python activity with all approval decisions embedded
		logger.Info("🔄 Re-invoking Graphton with approval decisions",
			"execution_id", executionID,
			"decisions_collected", signalsNeeded)

		finalStatus, err = executeGraphtonActivity.ExecuteGraphton(currentExecution, threadID)
		if err != nil {
			return w.wrapActivityError("ExecuteGraphton", err)
		}

		if finalStatus == nil {
			logger.Error("❌ ExecuteGraphton returned NULL status after approval", "execution_id", executionID)
			return fmt.Errorf("python activity returned null status after approval - this should never happen")
		}
	}

	logger.Info("✅ Graphton execution completed - final status received",
		"messages", len(finalStatus.GetMessages()),
		"tool_calls", len(finalStatus.GetToolCalls()),
		"phase", finalStatus.GetPhase().String(),
		"approval_cycles", approvalCycle)

	// Defense-in-depth: If the Python activity returned FAILED status, persist it
	// as a fallback. The primary persistence path is the Python gRPC update_status
	// call, but if that call failed (transient network issue, server down, etc.),
	// the error would be silently lost because the activity returned successfully
	// from Temporal's perspective. This ensures the failed state — including the
	// error message — is always persisted and broadcast to subscribers.
	if finalStatus.GetPhase() == agentexecutionv1.ExecutionPhase_EXECUTION_FAILED {
		logger.Warn("Activity returned EXECUTION_FAILED — persisting as fallback",
			"execution_id", executionID,
			"error", finalStatus.GetError())

		if err := w.persistFinalStatus(ctx, executionID, finalStatus); err != nil {
			logger.Error("Failed to persist fallback FAILED status",
				"execution_id", executionID, "error", err.Error())
			// Not fatal: the Python gRPC path may have already persisted it.
		}
	}

	return nil
}

// waitForApprovalSignal waits for a submitApproval signal from the handler.
//
// This method blocks until a signal is received. The signal carries the
// SubmitApprovalInput with the user's decision (APPROVE/SKIP/REJECT).
//
// The workflow uses Workflow.GetSignalChannel to receive signals, which
// is the recommended pattern for signal handling in Temporal Go SDK.
func (w *InvokeAgentExecutionWorkflowImpl) waitForApprovalSignal(ctx workflow.Context, executionID string) (*agentexecutionv1.SubmitApprovalInput, error) {
	logger := workflow.GetLogger(ctx)

	// Get signal channel for submitApproval
	signalChan := workflow.GetSignalChannel(ctx, SignalSubmitApproval)

	logger.Info("⏳ Waiting for submitApproval signal...", "execution_id", executionID)

	// Block until signal received
	var approvalInput agentexecutionv1.SubmitApprovalInput
	signalChan.Receive(ctx, &approvalInput)

	logger.Info("📝 Received submitApproval signal",
		"execution_id", executionID,
		"tool_call_id", approvalInput.GetToolCallId(),
		"action", approvalInput.GetAction().String())

	return &approvalInput, nil
}

// buildExecutionWithApprovalDecision creates a new execution with the approval decision embedded.
//
// The approval decision is stored in the ToolCall within the status:
//   - ToolCall.approval_action = submitted action (APPROVE/SKIP/REJECT)
//   - ToolCall.approval_decided_at = current timestamp (ISO 8601)
//
// The Python activity reads the approval action from the tool_call to determine
// how to handle the pending tool call (execute, skip, or fail).
//
// This follows the Java implementation pattern where the approval decision
// is embedded in the tool call for the Python activity to process.
func (w *InvokeAgentExecutionWorkflowImpl) buildExecutionWithApprovalDecision(
	ctx workflow.Context,
	execution *agentexecutionv1.AgentExecution,
	status *agentexecutionv1.AgentExecutionStatus,
	approvalInput *agentexecutionv1.SubmitApprovalInput,
) *agentexecutionv1.AgentExecution {
	// Find and update the tool call with the approval decision
	toolCallId := approvalInput.GetToolCallId()
	updatedToolCalls := make([]*agentexecutionv1.ToolCall, len(status.GetToolCalls()))

	// Get current time from workflow context (deterministic)
	now := workflow.Now(ctx).Format(time.RFC3339)

	for i, tc := range status.GetToolCalls() {
		if tc.GetId() == toolCallId {
			// Create updated tool call with approval decision
			updatedToolCalls[i] = &agentexecutionv1.ToolCall{
				Id:                  tc.GetId(),
				Name:                tc.GetName(),
				Args:                tc.GetArgs(),
				Result:              tc.GetResult(),
				Status:              tc.GetStatus(),
				ComponentMetadata:   tc.GetComponentMetadata(),
				StartedAt:           tc.GetStartedAt(),
				CompletedAt:         tc.GetCompletedAt(),
				Error:               tc.GetError(),
				RequiresApproval:    tc.GetRequiresApproval(),
				ApprovalMessage:     tc.GetApprovalMessage(),
				ApprovalRequestedAt: tc.GetApprovalRequestedAt(),
				ApprovalDecidedAt:   now,
				ApprovedBy:          "", // Would be set from auth context in production
				ApprovalAction:      approvalInput.GetAction(),
			}
		} else {
			updatedToolCalls[i] = tc
		}
	}

	// Build updated status with the modified tool call.
	// Carry forward pending_approvals so the Python resume logic can read
	// interrupt_ids for targeted Command(resume=...) construction.
	updatedStatus := &agentexecutionv1.AgentExecutionStatus{
		Phase:            status.GetPhase(),
		Messages:         status.GetMessages(),
		ToolCalls:        updatedToolCalls,
		PendingApprovals: status.GetPendingApprovals(), // All pending approvals with interrupt IDs
		Audit:            status.GetAudit(),
	}

	return &agentexecutionv1.AgentExecution{
		ApiVersion: execution.GetApiVersion(),
		Kind:       execution.GetKind(),
		Metadata:   execution.GetMetadata(),
		Spec:       execution.GetSpec(),
		Status:     updatedStatus,
	}
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
		Error: originalErr.Error(),
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

// persistFinalStatus persists a status returned by the Python activity as a fallback.
//
// This is a defense-in-depth mechanism for cases where the Python gRPC update_status
// call failed but the activity itself completed successfully (returning the failed
// status as a return value). The UpdateExecutionStatus activity merges the status
// into the existing record, so calling this when Python already persisted is safe
// (the merge is idempotent for identical data).
func (w *InvokeAgentExecutionWorkflowImpl) persistFinalStatus(ctx workflow.Context, executionID string, status *agentexecutionv1.AgentExecutionStatus) error {
	logger := workflow.GetLogger(ctx)

	localCtx := workflow.WithLocalActivityOptions(ctx, workflow.LocalActivityOptions{
		ScheduleToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
			InitialInterval: 2 * time.Second,
		},
	})

	err := workflow.ExecuteLocalActivity(localCtx, activities.UpdateExecutionStatusActivityName, executionID, status).Get(localCtx, nil)
	if err != nil {
		logger.Error("Failed to persist final status via fallback",
			"execution_id", executionID, "error", err.Error())
		return err
	}

	logger.Info("✅ Persisted final status via fallback",
		"execution_id", executionID,
		"phase", status.GetPhase().String())
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

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
func (w *InvokeAgentExecutionWorkflowImpl) Run(ctx workflow.Context, input *InvokeAgentExecutionWorkflowInput) error {
	logger := workflow.GetLogger(ctx)
	executionID := input.ExecutionID

	logger.Info("Starting workflow for execution", "execution_id", executionID)

	// Log callback token presence (for async activity completion pattern)
	// See: docs/adr/20260122-async-agent-execution-temporal-token-handshake.md
	callbackToken := input.CallbackToken
	if len(callbackToken) > 0 {
		logger.Info("Callback token detected - will complete external activity on finish",
			"execution_id", executionID,
			"token_length", len(callbackToken))
	}

	// Execute the Graphton flow
	if err := w.executeGraphtonFlow(ctx, input); err != nil {
		logger.Error("Workflow execution failed", "execution_id", executionID, "error", err.Error())

		if err := w.updateStatusOnFailure(ctx, executionID, err); err != nil {
			logger.Error("Failed to update execution status", "error", err.Error())
		}

		// Complete external activity with error (if token provided)
		if len(callbackToken) > 0 {
			if err := w.completeExternalActivity(ctx, callbackToken, nil, err); err != nil {
				logger.Error("Failed to complete external activity with error", "error", err.Error())
			}
		}

		return temporal.NewApplicationError("Workflow execution failed", "", err)
	}

	logger.Info("Workflow completed for execution (status updates were sent progressively via gRPC)", "execution_id", executionID)

	// Complete external activity with success (if token provided)
	if len(callbackToken) > 0 {
		// Load the current execution from DB so the external workflow receives
		// the completion-time state (not a stale creation-time snapshot).
		execution, err := w.loadExecution(ctx, executionID)
		if err != nil {
			logger.Error("Failed to load execution for callback result", "error", err.Error())
			return err
		}

		if err := w.completeExternalActivity(ctx, callbackToken, execution, nil); err != nil {
			logger.Error("Failed to complete external activity with success", "error", err.Error())
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
// Slim-Payload Pattern:
// The workflow passes only executionID (not the full AgentExecution proto) to
// the Python activity.  The Python activity hydrates the execution from the
// database via gRPC, keeping Temporal payloads small and bounded.  Approval
// decisions are forwarded as a small list of SubmitApprovalInput messages.
//
// HITL Approval Loop:
// When Python activity returns with EXECUTION_WAITING_FOR_APPROVAL, the workflow:
//   - Waits for submitApproval signal(s)
//   - Collects SubmitApprovalInput decisions
//   - Re-invokes Python activity with (executionID, threadID, decisions)
//   - Python correlates decisions with pending_approvals from the DB
//   - Continues until terminal state or max cycles reached
func (w *InvokeAgentExecutionWorkflowImpl) executeGraphtonFlow(ctx workflow.Context, input *InvokeAgentExecutionWorkflowInput) error {
	logger := workflow.GetLogger(ctx)

	sessionID := input.SessionID
	agentID := input.AgentID
	executionID := input.ExecutionID

	// Get activity task queue from workflow memo
	activityTaskQueue := w.getActivityTaskQueue(ctx)

	// Step 1: Ensure thread exists (Python activity)
	logger.Info("Step 1: Ensuring thread", "session_id", sessionID, "agent_id", agentID)

	ensureThreadActivity := activities.NewEnsureThreadActivityStub(ctx, activityTaskQueue)
	threadID, err := ensureThreadActivity.EnsureThread(sessionID, agentID)
	if err != nil {
		return w.wrapActivityError("EnsureThread", err)
	}

	logger.Info("Thread ensured", "thread_id", threadID)

	// Step 1.5: Generate session subject (fire-and-forget, non-blocking)
	//
	// Runs in parallel with the main agent execution -- uses an economy-tier LLM
	// to replace the "Auto-created session" sentinel with a concise, human-readable
	// title derived from the user's first message and agent context.
	//
	// Modelled on the Java workflow's Async.procedure() pattern. Failures are
	// logged and swallowed; a missing subject is cosmetic and must never block
	// or affect the outcome of the main execution.
	workflow.Go(ctx, func(ctx workflow.Context) {
		subjectActivity := activities.NewGenerateSessionSubjectActivityStub(ctx, activityTaskQueue)
		if err := subjectActivity.GenerateSessionSubject(executionID); err != nil {
			logger.Warn("Session subject generation failed (non-critical)",
				"execution_id", executionID,
				"error", err.Error())
		}
	})

	// Step 2: Execute Graphton with thread_id (Python activity)
	// Python activity:
	// - Fetches AgentExecution from DB via gRPC get(executionID)
	// - Executes agent and processes events
	// - Sends progressive status updates via gRPC (real-time)
	// - Returns final status to workflow (for observability)
	logger.Info("Step 2: Executing Graphton agent", "execution_id", executionID, "thread_id", threadID)
	logger.Info("Agent-runner will fetch execution from DB and send progressive status updates via gRPC during execution")

	executeGraphtonActivity := activities.NewExecuteGraphtonActivityStub(ctx, activityTaskQueue)

	// Initial execution -- no approval decisions on first invocation
	finalStatus, err := executeGraphtonActivity.ExecuteGraphton(executionID, threadID, nil)
	if err != nil {
		return w.wrapActivityError("ExecuteGraphton", err)
	}

	// Defensive null check
	if finalStatus == nil {
		logger.Error("ExecuteGraphton returned NULL status", "execution_id", executionID)
		return fmt.Errorf("python activity returned null status - this should never happen")
	}

	// Diagnostic: log the deserialized activity return value to trace
	// proto serialization issues between the Python activity and Go workflow.
	logger.Info("Activity returned status",
		"execution_id", executionID,
		"phase", finalStatus.GetPhase().String(),
		"phase_value", int32(finalStatus.GetPhase()),
		"pending_approvals", len(finalStatus.GetPendingApprovals()),
		"messages", len(finalStatus.GetMessages()),
		"tool_calls", len(finalStatus.GetToolCalls()))

	// Step 3: HITL Approval Loop (Batch Approval)
	//
	// When the Python activity returns EXECUTION_WAITING_FOR_APPROVAL, the
	// status may carry one OR more pending_approvals (one per interrupted
	// tool call).  We collect ALL approval signals before re-invoking the
	// activity so that the Python side can correlate decisions with
	// pending_approvals from the DB and construct a single
	//   Command(resume={interrupt_id_A: decision_A, interrupt_id_B: decision_B, ...})
	// avoiding repeated node re-executions.
	//
	// Falls back to single-signal behaviour when pending_approvals is empty
	// (legacy path).
	approvalCycle := 0
	for finalStatus.GetPhase() == agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL {
		approvalCycle++
		if approvalCycle > MaxApprovalCycles {
			logger.Error("Max approval cycles reached", "execution_id", executionID, "cycles", approvalCycle)
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

		logger.Info("Execution waiting for approval",
			"execution_id", executionID,
			"cycle", approvalCycle,
			"pending_count", signalsNeeded,
			"first_tool_call", firstToolCallId)

		// Belt-and-suspenders: persist the WAITING_FOR_APPROVAL status (including
		// pending_approvals) to the database via local activity before blocking on
		// the signal. The agent-runner already sent this via gRPC, but there is a
		// race: the gRPC update might not have been received/broadcast before the
		// CLI started listening. By persisting again here, the StreamBroker
		// broadcasts to any active subscriber, guaranteeing the CLI receives it.
		if err := w.persistFinalStatus(ctx, executionID, finalStatus); err != nil {
			logger.Warn("Failed to persist WAITING_FOR_APPROVAL status before signal wait (non-fatal)",
				"execution_id", executionID, "error", err.Error())
		}

		// Collect all approval signals into a slice of SubmitApprovalInput.
		// These are forwarded directly to the Python activity -- no need to
		// reconstruct the full AgentExecution with embedded decisions.
		approvalDecisions := make([]*agentexecutionv1.SubmitApprovalInput, 0, signalsNeeded)

		for i := 0; i < signalsNeeded; i++ {
			approvalInput, err := w.waitForApprovalSignal(ctx, executionID)
			if err != nil {
				return err
			}

			logger.Info("Received approval signal",
				"execution_id", executionID,
				"signal_index", i+1,
				"signals_needed", signalsNeeded,
				"tool_call_id", approvalInput.GetToolCallId(),
				"action", approvalInput.GetAction().String())

			approvalDecisions = append(approvalDecisions, approvalInput)

			// For REJECT, short-circuit: no need to collect more signals.
			if approvalInput.GetAction() == agentexecutionv1.ApprovalAction_APPROVAL_ACTION_REJECT {
				logger.Info("Tool rejected -- skipping remaining approvals",
					"execution_id", executionID,
					"tool_call_id", approvalInput.GetToolCallId())
				break
			}
		}

		// Re-invoke Python activity with collected approval decisions.
		// The activity will fetch the latest execution from DB (which has
		// pending_approvals with interrupt_ids) and correlate them with
		// the decisions to build the LangGraph resume command.
		//
		// Wrap in ApprovalDecisionList so the Go SDK serialises it as a
		// proto.Message (json/protobuf encoding) rather than a bare JSON
		// array (json/plain), which the Python SDK cannot decode.
		logger.Info("Re-invoking Graphton with approval decisions",
			"execution_id", executionID,
			"decisions_collected", len(approvalDecisions))

		decisionList := &agentexecutionv1.ApprovalDecisionList{
			Decisions: approvalDecisions,
		}
		finalStatus, err = executeGraphtonActivity.ExecuteGraphton(executionID, threadID, decisionList)
		if err != nil {
			return w.wrapActivityError("ExecuteGraphton", err)
		}

		if finalStatus == nil {
			logger.Error("ExecuteGraphton returned NULL status after approval", "execution_id", executionID)
			return fmt.Errorf("python activity returned null status after approval - this should never happen")
		}

		// Diagnostic: log deserialized status after approval re-invocation
		logger.Info("Activity returned status after approval",
			"execution_id", executionID,
			"phase", finalStatus.GetPhase().String(),
			"phase_value", int32(finalStatus.GetPhase()),
			"pending_approvals", len(finalStatus.GetPendingApprovals()),
			"messages", len(finalStatus.GetMessages()),
			"tool_calls", len(finalStatus.GetToolCalls()),
			"cycle", approvalCycle)
	}

	logger.Info("Graphton execution completed - final status received",
		"messages", len(finalStatus.GetMessages()),
		"tool_calls", len(finalStatus.GetToolCalls()),
		"phase", finalStatus.GetPhase().String(),
		"approval_cycles", approvalCycle)

	// Defense-in-depth: If the Python activity returned FAILED status, persist it
	// as a fallback. The primary persistence path is the Python gRPC update_status
	// call, but if that call failed (transient network issue, server down, etc.),
	// the error would be silently lost because the activity returned successfully
	// from Temporal's perspective. This ensures the failed state -- including the
	// error message -- is always persisted and broadcast to subscribers.
	if finalStatus.GetPhase() == agentexecutionv1.ExecutionPhase_EXECUTION_FAILED {
		logger.Warn("Activity returned EXECUTION_FAILED -- persisting as fallback",
			"execution_id", executionID,
			"error", finalStatus.GetError())

		if err := w.persistFinalStatus(ctx, executionID, finalStatus); err != nil {
			logger.Error("Failed to persist fallback FAILED status",
				"execution_id", executionID, "error", err.Error())
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

	logger.Info("Waiting for submitApproval signal...", "execution_id", executionID)

	// Block until signal received
	var approvalInput agentexecutionv1.SubmitApprovalInput
	signalChan.Receive(ctx, &approvalInput)

	logger.Info("Received submitApproval signal",
		"execution_id", executionID,
		"tool_call_id", approvalInput.GetToolCallId(),
		"action", approvalInput.GetAction().String())

	return &approvalInput, nil
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
			return fmt.Errorf(
				"activity '%s' failed: Activity stopped sending heartbeat (worker may have crashed). "+
					"Check agent-runner logs for errors. "+
					"Original error: %w",
				activityName, err,
			)
		case enums.TIMEOUT_TYPE_START_TO_CLOSE:
			return fmt.Errorf(
				"activity '%s' failed: Activity execution timed out. "+
					"The activity started but did not complete within the timeout period. "+
					"Check agent-runner logs for details. "+
					"Original error: %w",
				activityName, err,
			)
		default:
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

	logger.Info("Updated execution status to FAILED", "execution_id", executionID)
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

	logger.Info("Persisted final status via fallback",
		"execution_id", executionID,
		"phase", status.GetPhase().String())
	return nil
}

// loadExecution loads the current AgentExecution from the store via local activity.
//
// Used before completing an external activity (callback token pattern) to ensure
// the result reflects the completion-time state rather than a stale creation-time
// snapshot.
func (w *InvokeAgentExecutionWorkflowImpl) loadExecution(ctx workflow.Context, executionID string) (*agentexecutionv1.AgentExecution, error) {
	localCtx := workflow.WithLocalActivityOptions(ctx, workflow.LocalActivityOptions{
		ScheduleToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
			InitialInterval: 2 * time.Second,
		},
	})

	var execution agentexecutionv1.AgentExecution
	err := workflow.ExecuteLocalActivity(localCtx, activities.LoadAgentExecutionActivityName, executionID).Get(localCtx, &execution)
	if err != nil {
		return nil, fmt.Errorf("load execution %s: %w", executionID, err)
	}

	return &execution, nil
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
		logger.Warn("completeExternalActivity called with empty token - skipping")
		return nil
	}

	logger.Info("Completing external activity via system activity",
		"token_length", len(callbackToken),
		"has_result", result != nil,
		"has_error", err != nil)

	// Create activity options with appropriate timeouts
	activityCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 1 * time.Minute,
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
		logger.Error("System activity failed to complete external activity",
			"error", completionErr.Error())
		return completionErr
	}

	logger.Info("External activity completed successfully")
	return nil
}

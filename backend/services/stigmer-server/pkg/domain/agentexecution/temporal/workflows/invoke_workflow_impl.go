package workflows

import (
	"errors"
	"fmt"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal/activities"
	ecactivities "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/executioncontext/temporal/activities"
	"go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// InvokeAgentExecutionWorkflowImpl implements InvokeAgentExecutionWorkflow.
//
// Unified Runner Architecture:
// - Workflow (Go): Orchestrates activity execution on "agent_execution_stigmer" queue
// - TypeScript unified runner: Polls the activity task queue (global or per-session)
//   and registers ExecuteCursor, ExecuteDeepAgent, and workflow activities
// - Python agent-runner (legacy): ExecuteGraphton, EnsureThread on the same queue
//
// Harness dispatch: input.Harness determines which flow runs:
// - NATIVE/UNSPECIFIED: executeGraphtonFlow (EnsureThread -> ExecuteGraphton)
// - CURSOR: executeCursorFlow (ReadSessionThreadId -> ExecuteCursor)
//
// Queue routing: The activity task queue is stored in workflow memo at creation
// time. In global mode this is "agent_execution_runner"; in per-session mode
// it is "session:{session_id}". The unified runner registers all activities on
// a single queue, so Temporal routes by activity name within that queue.
//
// Both flows share the same HITL approval loop (approvalGateResolved signal)
// and pause/resume pattern (CancellationScope).
type InvokeAgentExecutionWorkflowImpl struct{}

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

	// Dispatch by harness
	var flowErr error
	if sessionv1.Harness(input.Harness) == sessionv1.Harness_HARNESS_CURSOR {
		flowErr = w.executeCursorFlow(ctx, input)
	} else {
		flowErr = w.executeGraphtonFlow(ctx, input)
	}
	if err := flowErr; err != nil {
		// Cancellation path: workflow was cancelled externally (user cancel, namespace timeout).
		// All cleanup runs in a disconnected context to guarantee execution.
		if temporal.IsCanceledError(ctx.Err()) {
			logger.Info("Workflow cancelled, running cancellation cleanup", "execution_id", executionID)
			w.handleCancellation(ctx, executionID, callbackToken)
			return err
		}

		// Failure path (unchanged)
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

		w.deleteExecutionContext(ctx, executionID)
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

	w.deleteExecutionContext(ctx, executionID)
	return nil
}

// MaxApprovalCycles is the maximum number of approval iterations to prevent infinite loops.
const MaxApprovalCycles = 100

// MaxPauseCycles is the maximum number of pause/resume cycles to prevent infinite loops.
const MaxPauseCycles = 100

// SignalApprovalGateResolved is the signal sent by SubmitApproval when the approval
// gate has fully resolved (all tool calls decided, or a REJECT was submitted).
// Must match the constant in temporal/workflow_types.go.
const SignalApprovalGateResolved = "approvalGateResolved"

// executeGraphtonFlow executes the Graphton agent flow with polyglot activities.
//
// Orchestrates:
// 1. Python activity: Ensure thread (on "execution" queue)
// 2. Python activity: Execute agent (on "execution" queue), with pause/resume
//   - During execution, agent-runner sends progressive status updates via gRPC
//   - Final status is returned for Temporal observability
//
// 3. Pause/resume outer loop: If a "pause" signal arrives while the activity is
//
//	running, the workflow cancels the activity (Python saves a LangGraph
//	checkpoint), waits for a "resume" signal, then re-invokes.
//
// 4. HITL approval loop (inside the pause scope): If a tool requires approval,
//
//	wait for approvalGateResolved signal and re-invoke.
//
// Modeled after the Java implementation's CancellationScope + Async.procedure
// pattern (InvokeAgentExecutionWorkflowImpl.java lines 452-533).
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
	workflow.Go(ctx, func(ctx workflow.Context) {
		subjectActivity := activities.NewGenerateSessionSubjectActivityStub(ctx, activityTaskQueue)
		if err := subjectActivity.GenerateSessionSubject(executionID); err != nil {
			logger.Warn("Session subject generation failed (non-critical)",
				"execution_id", executionID,
				"error", err.Error())
		}
	})

	// Step 2: Execute Graphton with pause/resume loop
	//
	// The outer loop handles pause/resume. When a "pause" signal arrives, the
	// workflow cancels the activity context (which propagates to the running
	// activity AND any HITL approval waits), then blocks on a "resume" signal
	// before re-invoking.
	//
	// Pattern: workflow.Go() monitors the pause signal and calls cancelActivity()
	// when received — equivalent to Java's Async.procedure + CancellationScope.
	logger.Info("Step 2: Executing Graphton agent", "execution_id", executionID, "thread_id", threadID)

	pauseCh := workflow.GetSignalChannel(ctx, SignalPause)
	resumeCh := workflow.GetSignalChannel(ctx, SignalResume)

	var finalStatus *agentexecutionv1.AgentExecutionStatus
	pauseCycle := 0

	for {
		var pauseRequested bool
		activityCtx, cancelActivity := workflow.WithCancel(ctx)

		// Monitor for pause signal concurrently. The goroutine is tied to
		// activityCtx so it is cleaned up when the context is cancelled
		// (either by pause or by normal completion calling cancelActivity).
		workflow.Go(activityCtx, func(gCtx workflow.Context) {
			var reason string
			if !pauseCh.Receive(gCtx, &reason) {
				return // context cancelled — not a real signal
			}
			logger.Info("Pause signal received",
				"execution_id", executionID, "reason", reason)
			pauseRequested = true
			cancelActivity()
		})

		// Execute the agent with HITL approval loop (uses cancellable context)
		finalStatus, err = w.executeGraphtonWithHitl(
			activityCtx, activityTaskQueue, executionID, threadID,
		)

		if err != nil && pauseRequested {
			// Activity (or HITL wait) was cancelled for pause.
			pauseCycle++
			if pauseCycle > MaxPauseCycles {
				logger.Error("Max pause cycles reached",
					"execution_id", executionID, "cycles", pauseCycle)
				return fmt.Errorf("max pause cycles (%d) reached - possible infinite loop", MaxPauseCycles)
			}

			logger.Info("Execution paused — checkpoint saved, waiting for resume signal",
				"execution_id", executionID, "pause_cycle", pauseCycle)

			// Defense-in-depth: persist PAUSED status from the workflow.
			// The Pause RPC pipeline already set PAUSED in the DB, but this
			// ensures the latest messages/tool_calls from the activity's final
			// gRPC update are also reflected.
			pausedStatus := &agentexecutionv1.AgentExecutionStatus{
				Phase: agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED,
			}
			if persistErr := w.persistFinalStatus(ctx, executionID, pausedStatus); persistErr != nil {
				logger.Warn("Failed to persist PAUSED status (non-fatal)",
					"execution_id", executionID, "error", persistErr.Error())
			}

			// Wait for resume signal (on PARENT context — not cancelled)
			resumeCh.Receive(ctx, nil)

			logger.Info("Resume signal received — restarting activity from checkpoint",
				"execution_id", executionID, "pause_cycle", pauseCycle)
			continue
		}

		// Normal completion or error — cancel the activity context to clean up
		// the pause-monitoring goroutine.
		cancelActivity()

		if err != nil {
			return w.wrapActivityError("ExecuteGraphton", err)
		}

		// Activity completed normally
		break
	}

	logger.Info("Graphton execution completed - final slim status received",
		"execution_id", executionID,
		"phase", finalStatus.GetPhase().String(),
		"pending_approvals", len(finalStatus.GetPendingApprovals()),
		"pause_cycles", pauseCycle)

	// Defense-in-depth: persist FAILED status as a fallback. The primary path
	// is Python's gRPC update_status call, but if that failed (transient network
	// issue, server down), the error would be silently lost.
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

// executeGraphtonWithHitl runs the ExecuteGraphton activity and handles the HITL
// approval loop. It uses the provided context for all blocking operations, so the
// caller can cancel it (e.g., for pause).
//
// Extracted from executeGraphtonFlow to work with the pause/resume cancellation
// scope, matching Java's executeGraphtonWithHitl() pattern.
func (w *InvokeAgentExecutionWorkflowImpl) executeGraphtonWithHitl(
	ctx workflow.Context,
	activityTaskQueue string,
	executionID string,
	threadID string,
) (*agentexecutionv1.AgentExecutionStatus, error) {
	logger := workflow.GetLogger(ctx)

	executeGraphtonActivity := activities.NewExecuteGraphtonActivityStub(ctx, activityTaskQueue)

	finalStatus, err := executeGraphtonActivity.ExecuteGraphton(executionID, threadID)
	if err != nil {
		return nil, err
	}

	if finalStatus == nil {
		logger.Error("ExecuteGraphton returned NULL status", "execution_id", executionID)
		return nil, fmt.Errorf("python activity returned null status - this should never happen")
	}

	logger.Info("Activity returned slim status",
		"execution_id", executionID,
		"phase", finalStatus.GetPhase().String(),
		"phase_value", int32(finalStatus.GetPhase()))

	// HITL Approval Loop (DB-Driven Resume)
	//
	// When Python returns EXECUTION_WAITING_FOR_APPROVAL, the workflow persists
	// the status, loads the execution from DB to get the authoritative
	// pending_approvals (computed by ComputePendingApprovals on every
	// UpdateStatus write), then waits for a single approvalGateResolved signal.
	//
	// All blocking operations use the provided ctx so that cancellation (from the
	// pause/resume outer loop) propagates through.
	approvalCycle := 0
	for finalStatus.GetPhase() == agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL {
		approvalCycle++
		if approvalCycle > MaxApprovalCycles {
			logger.Error("Max approval cycles reached", "execution_id", executionID, "cycles", approvalCycle)
			return nil, fmt.Errorf("max approval cycles (%d) reached - possible infinite loop", MaxApprovalCycles)
		}

		if err := w.persistFinalStatus(ctx, executionID, finalStatus); err != nil {
			logger.Warn("Failed to persist WAITING_FOR_APPROVAL status before signal wait (non-fatal)",
				"execution_id", executionID, "error", err.Error())
		}

		// Read pending_approvals from DB — the single source of truth.
		// ComputePendingApprovals runs on every UpdateStatus write, so
		// the DB always has the authoritative count.
		dbExecution, loadErr := w.loadExecution(ctx, executionID)
		pendingCount := 0
		if loadErr != nil {
			logger.Warn("Failed to load execution from DB for pending count (non-fatal, will wait for signal)",
				"execution_id", executionID, "error", loadErr.Error())
			pendingCount = 1 // assume pending to avoid skipping the signal wait
		} else {
			pendingCount = len(dbExecution.GetStatus().GetPendingApprovals())
		}

		logger.Info("Execution waiting for approval — waiting for approvalGateResolved signal",
			"execution_id", executionID,
			"cycle", approvalCycle,
			"pending_count", pendingCount)

		if pendingCount == 0 {
			logger.Warn("pending_approvals is empty but phase is WAITING_FOR_APPROVAL — "+
				"re-invoking Python immediately to resolve inconsistency",
				"execution_id", executionID,
				"cycle", approvalCycle)
		} else {
			signalChan := workflow.GetSignalChannel(ctx, SignalApprovalGateResolved)
			signalChan.Receive(ctx, nil)

			logger.Info("Received approvalGateResolved signal",
				"execution_id", executionID,
				"cycle", approvalCycle)
		}

		logger.Info("Re-invoking Graphton after approval gate resolved",
			"execution_id", executionID,
			"cycle", approvalCycle)

		finalStatus, err = executeGraphtonActivity.ExecuteGraphton(executionID, threadID)
		if err != nil {
			return nil, err
		}

		if finalStatus == nil {
			logger.Error("ExecuteGraphton returned NULL status after approval", "execution_id", executionID)
			return nil, fmt.Errorf("python activity returned null status after approval - this should never happen")
		}

		logger.Info("Activity returned slim status after approval",
			"execution_id", executionID,
			"phase", finalStatus.GetPhase().String(),
			"phase_value", int32(finalStatus.GetPhase()),
			"cycle", approvalCycle)
	}

	return finalStatus, nil
}

// executeCursorFlow executes a Cursor harness agent. Structurally identical to
// executeGraphtonFlow with two variation points:
//   - threadId comes from ReadSessionThreadId (not EnsureThread)
//   - ExecuteCursor activity (not ExecuteGraphton)
//
// Same GenerateSessionSubject (fire-and-forget), same HITL approval loop,
// same pause/resume pattern.
func (w *InvokeAgentExecutionWorkflowImpl) executeCursorFlow(ctx workflow.Context, input *InvokeAgentExecutionWorkflowInput) error {
	logger := workflow.GetLogger(ctx)

	sessionID := input.SessionID
	executionID := input.ExecutionID

	activityTaskQueue := w.getActivityTaskQueue(ctx)

	// Generate session subject (fire-and-forget, non-blocking).
	// The Cursor SDK does not expose a generated conversation title for local
	// agents, so we use the same LLM-based title generation as the Graphton flow.
	workflow.Go(ctx, func(ctx workflow.Context) {
		subjectActivity := activities.NewGenerateSessionSubjectActivityStub(ctx, activityTaskQueue)
		if err := subjectActivity.GenerateSessionSubject(executionID); err != nil {
			logger.Warn("Session subject generation failed (non-critical)",
				"execution_id", executionID,
				"error", err.Error())
		}
	})

	logger.Info("Executing Cursor agent", "execution_id", executionID, "session_id", sessionID)

	pauseCh := workflow.GetSignalChannel(ctx, SignalPause)
	resumeCh := workflow.GetSignalChannel(ctx, SignalResume)

	var finalStatus *agentexecutionv1.AgentExecutionStatus
	pauseCycle := 0

	for {
		var pauseRequested bool
		activityCtx, cancelActivity := workflow.WithCancel(ctx)

		workflow.Go(activityCtx, func(gCtx workflow.Context) {
			var reason string
			if !pauseCh.Receive(gCtx, &reason) {
				return
			}
			logger.Info("Pause signal received", "execution_id", executionID, "reason", reason)
			pauseRequested = true
			cancelActivity()
		})

		result, err := w.executeCursorWithHitl(activityCtx, activityTaskQueue, executionID, sessionID)

		if err != nil && pauseRequested {
			pauseCycle++
			if pauseCycle > MaxPauseCycles {
				return fmt.Errorf("max pause cycles (%d) reached - possible infinite loop", MaxPauseCycles)
			}

			logger.Info("Cursor execution paused, waiting for resume signal",
				"execution_id", executionID, "pause_cycle", pauseCycle)

			pausedStatus := &agentexecutionv1.AgentExecutionStatus{
				Phase: agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED,
			}
			if persistErr := w.persistFinalStatus(ctx, executionID, pausedStatus); persistErr != nil {
				logger.Warn("Failed to persist PAUSED status (non-fatal)",
					"execution_id", executionID, "error", persistErr.Error())
			}

			resumeCh.Receive(ctx, nil)
			logger.Info("Resume signal received, restarting Cursor activity",
				"execution_id", executionID, "pause_cycle", pauseCycle)
			continue
		}

		cancelActivity()

		if err != nil {
			return w.wrapActivityError("ExecuteCursor", err)
		}

		finalStatus = result
		break
	}

	logger.Info("Cursor execution completed",
		"execution_id", executionID,
		"phase", finalStatus.GetPhase().String(),
		"pause_cycles", pauseCycle)

	if finalStatus.GetPhase() == agentexecutionv1.ExecutionPhase_EXECUTION_FAILED {
		logger.Warn("Activity returned EXECUTION_FAILED -- persisting as fallback",
			"execution_id", executionID, "error", finalStatus.GetError())
		if err := w.persistFinalStatus(ctx, executionID, finalStatus); err != nil {
			logger.Error("Failed to persist fallback FAILED status",
				"execution_id", executionID, "error", err.Error())
		}
	}

	return nil
}

// executeCursorWithHitl runs the ExecuteCursor activity and handles the HITL
// approval loop. Reads threadId from the session before each invocation so
// the Cursor agentId (stored by the activity on first run) is available for
// reinvocations.
func (w *InvokeAgentExecutionWorkflowImpl) executeCursorWithHitl(
	ctx workflow.Context,
	activityTaskQueue string,
	executionID string,
	sessionID string,
) (*agentexecutionv1.AgentExecutionStatus, error) {
	logger := workflow.GetLogger(ctx)

	// Read threadId (Cursor agentId) from session — empty on first execution,
	// populated by the activity after Agent.create().
	threadID, err := w.readSessionThreadId(ctx, sessionID)
	if err != nil {
		logger.Warn("Failed to read session thread_id (non-fatal, using empty)",
			"session_id", sessionID, "error", err.Error())
		threadID = ""
	}

	executeCursorActivity := activities.NewExecuteCursorActivityStub(ctx, activityTaskQueue)

	finalStatus, err := executeCursorActivity.ExecuteCursor(executionID, threadID)
	if err != nil {
		return nil, err
	}

	if finalStatus == nil {
		return nil, fmt.Errorf("cursor activity returned null status - this should never happen")
	}

	logger.Info("Cursor activity returned slim status",
		"execution_id", executionID,
		"phase", finalStatus.GetPhase().String())

	approvalCycle := 0
	for finalStatus.GetPhase() == agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL {
		approvalCycle++
		if approvalCycle > MaxApprovalCycles {
			return nil, fmt.Errorf("max approval cycles (%d) reached - possible infinite loop", MaxApprovalCycles)
		}

		if err := w.persistFinalStatus(ctx, executionID, finalStatus); err != nil {
			logger.Warn("Failed to persist WAITING_FOR_APPROVAL status (non-fatal)",
				"execution_id", executionID, "error", err.Error())
		}

		dbExecution, loadErr := w.loadExecution(ctx, executionID)
		pendingCount := 0
		if loadErr != nil {
			logger.Warn("Failed to load execution for pending count (non-fatal)",
				"execution_id", executionID, "error", loadErr.Error())
			pendingCount = 1
		} else {
			pendingCount = len(dbExecution.GetStatus().GetPendingApprovals())
		}

		logger.Info("Cursor execution waiting for approval",
			"execution_id", executionID, "cycle", approvalCycle, "pending_count", pendingCount)

		if pendingCount == 0 {
			logger.Warn("pending_approvals empty but phase is WAITING_FOR_APPROVAL — re-invoking immediately",
				"execution_id", executionID, "cycle", approvalCycle)
		} else {
			signalChan := workflow.GetSignalChannel(ctx, SignalApprovalGateResolved)
			signalChan.Receive(ctx, nil)
			logger.Info("Received approvalGateResolved signal",
				"execution_id", executionID, "cycle", approvalCycle)
		}

		// Re-read threadId — the first ExecuteCursor call stored the Cursor agentId
		threadID, err = w.readSessionThreadId(ctx, sessionID)
		if err != nil {
			return nil, fmt.Errorf("failed to read session thread_id for reinvocation: %w", err)
		}

		logger.Info("Re-invoking Cursor after approval", "execution_id", executionID,
			"cycle", approvalCycle, "thread_id", threadID)

		finalStatus, err = executeCursorActivity.ExecuteCursor(executionID, threadID)
		if err != nil {
			return nil, err
		}

		if finalStatus == nil {
			return nil, fmt.Errorf("cursor activity returned null status after approval - this should never happen")
		}

		logger.Info("Cursor activity returned slim status after approval",
			"execution_id", executionID,
			"phase", finalStatus.GetPhase().String(),
			"cycle", approvalCycle)
	}

	return finalStatus, nil
}

// readSessionThreadId reads the thread_id from a session via local activity.
func (w *InvokeAgentExecutionWorkflowImpl) readSessionThreadId(ctx workflow.Context, sessionID string) (string, error) {
	localCtx := workflow.WithLocalActivityOptions(ctx, workflow.LocalActivityOptions{
		ScheduleToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
			InitialInterval: 2 * time.Second,
		},
	})

	var threadID string
	err := workflow.ExecuteLocalActivity(localCtx, activities.ReadSessionThreadIdActivityName, sessionID).Get(localCtx, &threadID)
	if err != nil {
		return "", fmt.Errorf("read session thread_id for %s: %w", sessionID, err)
	}
	return threadID, nil
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
//
// Uses a regular activity (not local) on the stigmer workflow queue. Local activities
// produce RECORD_MARKER events that trigger a Temporal SDK state machine bug when
// executed in the same workflow task as a remote activity failure (e.g., ScheduleToStart
// timeout on a dead runner queue). Regular activities produce standard
// ActivityTaskScheduled/Completed events, sidestepping the issue entirely.
func (w *InvokeAgentExecutionWorkflowImpl) updateStatusOnFailure(ctx workflow.Context, executionID string, originalErr error) error {
	logger := workflow.GetLogger(ctx)

	logger.Info("Updating execution status to FAILED", "execution_id", executionID)

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

	activityCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
			InitialInterval: 2 * time.Second,
		},
	})

	err := workflow.ExecuteActivity(activityCtx, activities.UpdateExecutionStatusActivityName, executionID, failedStatus).Get(activityCtx, nil)
	if err != nil {
		logger.Error("Failed to update execution status", "error", err.Error())
		return err
	}

	logger.Info("Updated execution status to FAILED", "execution_id", executionID)
	return nil
}

// handleCancellation performs cleanup when the workflow is cancelled externally
// (user cancellation, namespace timeout). All operations run in a disconnected
// context so they complete even though the workflow context is cancelled.
//
// Operations are best-effort: each is attempted independently and failures are
// logged but never propagated. The execution must reach a terminal state
// (CANCELLED) and secrets (ExecutionContext) must be cleaned up regardless.
func (w *InvokeAgentExecutionWorkflowImpl) handleCancellation(
	ctx workflow.Context, executionID string, callbackToken []byte,
) {
	logger := workflow.GetLogger(ctx)

	cleanupCtx, cancel := workflow.NewDisconnectedContext(ctx)
	defer cancel()

	w.updateStatusOnCancellation(cleanupCtx, executionID)

	if len(callbackToken) > 0 {
		if err := w.completeExternalActivity(cleanupCtx, callbackToken, nil,
			fmt.Errorf("execution cancelled")); err != nil {
			logger.Warn("Failed to notify parent of cancellation (best-effort)",
				"execution_id", executionID, "error", err.Error())
		}
	}

	w.deleteExecutionContext(cleanupCtx, executionID)
}

// updateStatusOnCancellation updates the execution status to CANCELLED.
// Best-effort: logs on error but never propagates.
//
// Uses a regular activity for the same replay-safety reasons as updateStatusOnFailure.
// The caller (handleCancellation) provides a disconnected context so this activity
// completes even when the workflow context is already cancelled.
func (w *InvokeAgentExecutionWorkflowImpl) updateStatusOnCancellation(ctx workflow.Context, executionID string) {
	logger := workflow.GetLogger(ctx)

	cancelledStatus := &agentexecutionv1.AgentExecutionStatus{
		Phase: agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED,
		Error: "Execution cancelled",
		Messages: []*agentexecutionv1.AgentMessage{
			{
				Type:    agentexecutionv1.MessageType_MESSAGE_SYSTEM,
				Content: "Execution was cancelled.",
			},
		},
	}

	activityCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
			InitialInterval: 2 * time.Second,
		},
	})

	err := workflow.ExecuteActivity(activityCtx, activities.UpdateExecutionStatusActivityName, executionID, cancelledStatus).Get(activityCtx, nil)
	if err != nil {
		logger.Warn("Failed to update execution status to CANCELLED",
			"execution_id", executionID, "error", err.Error())
		return
	}

	logger.Info("Updated execution status to CANCELLED", "execution_id", executionID)
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

// deleteExecutionContext deletes the ephemeral ExecutionContext that was created
// during execution setup. The ExecutionContext holds the fully-merged environment
// (including secrets) and must be cleaned up when the workflow finishes.
//
// Uses workflow.NewDisconnectedContext so cleanup runs even if the workflow was
// cancelled. Errors are logged but never propagated -- cleanup is best-effort
// with TTL-based backup for orphaned contexts.
func (w *InvokeAgentExecutionWorkflowImpl) deleteExecutionContext(ctx workflow.Context, executionID string) {
	logger := workflow.GetLogger(ctx)

	cleanupCtx, cancel := workflow.NewDisconnectedContext(ctx)
	defer cancel()

	localCtx := workflow.WithLocalActivityOptions(cleanupCtx, workflow.LocalActivityOptions{
		ScheduleToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
			InitialInterval: 2 * time.Second,
		},
	})

	err := workflow.ExecuteLocalActivity(localCtx,
		ecactivities.DeleteExecutionContextActivityName, executionID,
	).Get(localCtx, nil)

	if err != nil {
		logger.Warn("ExecutionContext cleanup failed (will rely on TTL backup)",
			"execution_id", executionID, "error", err.Error())
		return
	}

	logger.Info("ExecutionContext cleaned up", "execution_id", executionID)
}

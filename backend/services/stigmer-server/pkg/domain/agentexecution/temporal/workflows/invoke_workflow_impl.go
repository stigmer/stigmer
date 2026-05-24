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
//   - Workflow (Go): Orchestrates activity execution on "agent_execution_stigmer" queue
//   - TypeScript unified runner: Polls the activity task queue (global or per-session)
//     and registers ExecuteCursor, ExecuteDeepAgent, and workflow activities
//
// Harness dispatch: input.Harness determines which flow runs:
// - NATIVE/UNSPECIFIED: executeDeepAgentFlow (EnsureThread -> ExecuteDeepAgent)
// - CURSOR: executeCursorFlow (ReadHarnessStateId -> ExecuteCursor)
//
// Queue routing: The activity task queue is stored in workflow memo at creation
// time. In global mode this is "agent_execution_runner"; in per-session mode
// it is "session:{session_id}". The unified runner registers all activities on
// a single queue, so Temporal routes by activity name within that queue.
//
// Both flows share the same HITL approval loop (approvalGateResolved signal)
// and pause/resume pattern (CancellationScope).
type InvokeAgentExecutionWorkflowImpl struct {
	lastActivityResult activities.RunnerActivityResult
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

	// Notify parent workflow that child execution has started (enables live subscription).
	// Uses SignalExternalWorkflow — non-blocking, fire-and-forget.
	if input.ParentWorkflowID != "" {
		signalCtx, signalCancel := workflow.WithCancel(ctx)
		workflow.Go(signalCtx, func(gCtx workflow.Context) {
			defer signalCancel()
			payload := struct {
				ExecutionID string `json:"executionId"`
			}{ExecutionID: executionID}
			err := workflow.SignalExternalWorkflow(gCtx, input.ParentWorkflowID, "", "child_execution_started", payload).Get(gCtx, nil)
			if err != nil {
				logger.Warn("Failed to signal parent execution started (non-fatal)",
					"parent_workflow_id", input.ParentWorkflowID,
					"error", err)
			}
		})
	}

	// Dispatch by harness
	var flowErr error
	var lastActivityResult activities.RunnerActivityResult
	if sessionv1.Harness(input.Harness) == sessionv1.Harness_HARNESS_CURSOR {
		lastActivityResult, flowErr = w.executeCursorFlowWithResult(ctx, input)
	} else {
		lastActivityResult, flowErr = w.executeDeepAgentFlowWithResult(ctx, input)
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
		execution, err := w.loadExecution(ctx, executionID)
		if err != nil {
			logger.Error("Failed to load execution for callback result", "error", err.Error())
			return err
		}

		callbackResult := w.buildCallbackResult(lastActivityResult, execution)

		if err := w.completeExternalActivity(ctx, callbackToken, callbackResult, nil); err != nil {
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

// executeDeepAgentFlow executes the native deep agent flow.
//
// Orchestrates:
// 1. EnsureThread activity (on runner queue)
// 2. ExecuteDeepAgent activity (on runner queue), with pause/resume
//   - During execution, the unified runner sends progressive status updates via gRPC
//   - Final status is returned for Temporal observability
//
// 3. Pause/resume outer loop: If a "pause" signal arrives while the activity is
//
//	running, the workflow cancels the activity (LangGraph saves a
//	checkpoint), waits for a "resume" signal, then re-invokes.
//
// 4. HITL approval loop (inside the pause scope): If a tool requires approval,
//
//	wait for approvalGateResolved signal and re-invoke.
func (w *InvokeAgentExecutionWorkflowImpl) executeDeepAgentFlow(ctx workflow.Context, input *InvokeAgentExecutionWorkflowInput) error {
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

	// Step 2: Execute deep agent with pause/resume loop
	//
	// The outer loop handles pause/resume. When a "pause" signal arrives, the
	// workflow cancels the activity context (which propagates to the running
	// activity AND any HITL approval waits), then blocks on a "resume" signal
	// before re-invoking.
	//
	// Pattern: workflow.Go() monitors the pause signal and calls cancelActivity()
	// when received — equivalent to Java's Async.procedure + CancellationScope.
	logger.Info("Step 2: Executing deep agent", "execution_id", executionID, "thread_id", threadID)

	pauseCh := workflow.GetSignalChannel(ctx, SignalPause)
	resumeCh := workflow.GetSignalChannel(ctx, SignalResume)

	var finalResult activities.RunnerActivityResult
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
		finalResult, err = w.executeDeepAgentWithHitl(
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
			return w.wrapActivityError("ExecuteDeepAgent", err)
		}

		// Activity completed normally
		break
	}

	w.lastActivityResult = finalResult
	finalPhase := activities.GetPhaseFromResult(finalResult)
	logger.Info("Deep agent execution completed - final slim status received",
		"execution_id", executionID,
		"phase", finalPhase.String(),
		"pause_cycles", pauseCycle)

	// Defense-in-depth: persist FAILED status as a fallback.
	if finalPhase == agentexecutionv1.ExecutionPhase_EXECUTION_FAILED {
		finalError := activities.GetErrorFromResult(finalResult)
		logger.Warn("Activity returned EXECUTION_FAILED -- propagating to parent workflow",
			"execution_id", executionID,
			"error", finalError)

		failedStatus := &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
			Error: finalError,
		}
		if err := w.persistFinalStatus(ctx, executionID, failedStatus); err != nil {
			logger.Error("Failed to persist fallback FAILED status",
				"execution_id", executionID, "error", err.Error())
		}

		return fmt.Errorf("agent execution failed: %s", finalError)
	}

	return nil
}

// executeDeepAgentWithHitl runs the ExecuteDeepAgent activity and handles the HITL
// approval loop. It uses the provided context for all blocking operations, so the
// caller can cancel it (e.g., for pause).
func (w *InvokeAgentExecutionWorkflowImpl) executeDeepAgentWithHitl(
	ctx workflow.Context,
	activityTaskQueue string,
	executionID string,
	threadID string,
) (activities.RunnerActivityResult, error) {
	logger := workflow.GetLogger(ctx)

	executeDeepAgentActivity := activities.NewExecuteDeepAgentActivityStub(ctx, activityTaskQueue)

	finalResult, err := executeDeepAgentActivity.ExecuteDeepAgent(executionID, threadID)
	if err != nil {
		return nil, err
	}

	if finalResult == nil {
		logger.Error("ExecuteDeepAgent returned NULL status", "execution_id", executionID)
		return nil, fmt.Errorf("activity returned null status - this should never happen")
	}

	finalPhase := activities.GetPhaseFromResult(finalResult)
	logger.Info("Activity returned slim status",
		"execution_id", executionID,
		"phase", finalPhase.String(),
		"phase_value", int32(finalPhase))

	approvalCycle := 0
	for finalPhase == agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL {
		approvalCycle++
		if approvalCycle > MaxApprovalCycles {
			logger.Error("Max approval cycles reached", "execution_id", executionID, "cycles", approvalCycle)
			return nil, fmt.Errorf("max approval cycles (%d) reached - possible infinite loop", MaxApprovalCycles)
		}

		waitingStatus := &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
		}
		if err := w.persistFinalStatus(ctx, executionID, waitingStatus); err != nil {
			logger.Warn("Failed to persist WAITING_FOR_APPROVAL status before signal wait (non-fatal)",
				"execution_id", executionID, "error", err.Error())
		}

		dbExecution, loadErr := w.loadExecution(ctx, executionID)
		pendingCount := 0
		if loadErr != nil {
			logger.Warn("Failed to load execution from DB for pending count (non-fatal, will wait for signal)",
				"execution_id", executionID, "error", loadErr.Error())
			pendingCount = 1
		} else {
			pendingCount = len(dbExecution.GetStatus().GetPendingApprovals())
		}

		logger.Info("Execution waiting for approval — waiting for approvalGateResolved signal",
			"execution_id", executionID,
			"cycle", approvalCycle,
			"pending_count", pendingCount)

		if pendingCount == 0 {
			logger.Warn("pending_approvals is empty but phase is WAITING_FOR_APPROVAL — "+
				"re-invoking immediately to resolve inconsistency",
				"execution_id", executionID,
				"cycle", approvalCycle)
		} else {
			signalChan := workflow.GetSignalChannel(ctx, SignalApprovalGateResolved)
			signalChan.Receive(ctx, nil)

			logger.Info("Received approvalGateResolved signal",
				"execution_id", executionID,
				"cycle", approvalCycle)
		}

		logger.Info("Re-invoking deep agent after approval gate resolved",
			"execution_id", executionID,
			"cycle", approvalCycle)

		finalResult, err = executeDeepAgentActivity.ExecuteDeepAgent(executionID, threadID)
		if err != nil {
			return nil, err
		}

		if finalResult == nil {
			logger.Error("ExecuteDeepAgent returned NULL status after approval", "execution_id", executionID)
			return nil, fmt.Errorf("activity returned null status after approval - this should never happen")
		}

		finalPhase = activities.GetPhaseFromResult(finalResult)
		logger.Info("Activity returned slim status after approval",
			"execution_id", executionID,
			"phase", finalPhase.String(),
			"phase_value", int32(finalPhase),
			"cycle", approvalCycle)
	}

	return finalResult, nil
}

// executeCursorFlow executes a Cursor harness agent. Structurally identical to
// executeDeepAgentFlow with two variation points:
//   - harnessStateId comes from ReadHarnessStateId (not EnsureThread)
//   - ExecuteCursor activity (not ExecuteDeepAgent)
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
	// agents, so we use the same LLM-based title generation as the deep agent flow.
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

	var finalResult activities.RunnerActivityResult
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

		cursorResult, err := w.executeCursorWithHitl(activityCtx, activityTaskQueue, executionID, sessionID)

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

		finalResult = cursorResult
		break
	}

	w.lastActivityResult = finalResult
	finalPhase := activities.GetPhaseFromResult(finalResult)
	logger.Info("Cursor execution completed",
		"execution_id", executionID,
		"phase", finalPhase.String(),
		"pause_cycles", pauseCycle)

	if finalPhase == agentexecutionv1.ExecutionPhase_EXECUTION_FAILED {
		finalError := activities.GetErrorFromResult(finalResult)
		logger.Warn("Activity returned EXECUTION_FAILED -- propagating to parent workflow",
			"execution_id", executionID, "error", finalError)

		failedStatus := &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_FAILED,
			Error: finalError,
		}
		if err := w.persistFinalStatus(ctx, executionID, failedStatus); err != nil {
			logger.Error("Failed to persist fallback FAILED status",
				"execution_id", executionID, "error", err.Error())
		}

		return fmt.Errorf("agent execution failed: %s", finalError)
	}

	return nil
}

// executeCursorWithHitl runs the ExecuteCursor activity and handles the HITL
// approval loop. Reads harness_state_id from the session before each invocation so
// the Cursor agentId (stored by the activity on first run) is available for
// reinvocations.
func (w *InvokeAgentExecutionWorkflowImpl) executeCursorWithHitl(
	ctx workflow.Context,
	activityTaskQueue string,
	executionID string,
	sessionID string,
) (activities.RunnerActivityResult, error) {
	logger := workflow.GetLogger(ctx)

	harnessStateID, err := w.readHarnessStateId(ctx, sessionID)
	if err != nil {
		logger.Warn("Failed to read session harness_state_id (non-fatal, using empty)",
			"session_id", sessionID, "error", err.Error())
		harnessStateID = ""
	}

	executeCursorActivity := activities.NewExecuteCursorActivityStub(ctx, activityTaskQueue)

	finalResult, err := executeCursorActivity.ExecuteCursor(executionID, harnessStateID)
	if err != nil {
		return nil, err
	}

	if finalResult == nil {
		return nil, fmt.Errorf("cursor activity returned null status - this should never happen")
	}

	finalPhase := activities.GetPhaseFromResult(finalResult)
	logger.Info("Cursor activity returned slim status",
		"execution_id", executionID,
		"phase", finalPhase.String())

	approvalCycle := 0
	for finalPhase == agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL {
		approvalCycle++
		if approvalCycle > MaxApprovalCycles {
			return nil, fmt.Errorf("max approval cycles (%d) reached - possible infinite loop", MaxApprovalCycles)
		}

		waitingStatus := &agentexecutionv1.AgentExecutionStatus{
			Phase: agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
		}
		if err := w.persistFinalStatus(ctx, executionID, waitingStatus); err != nil {
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

		harnessStateID, err = w.readHarnessStateId(ctx, sessionID)
		if err != nil {
			return nil, fmt.Errorf("failed to read session harness_state_id for reinvocation: %w", err)
		}

		logger.Info("Re-invoking Cursor after approval", "execution_id", executionID,
			"cycle", approvalCycle, "harness_state_id", harnessStateID)

		finalResult, err = executeCursorActivity.ExecuteCursor(executionID, harnessStateID)
		if err != nil {
			return nil, err
		}

		if finalResult == nil {
			return nil, fmt.Errorf("cursor activity returned null status after approval - this should never happen")
		}

		finalPhase = activities.GetPhaseFromResult(finalResult)
		logger.Info("Cursor activity returned slim status after approval",
			"execution_id", executionID,
			"phase", finalPhase.String(),
			"cycle", approvalCycle)
	}

	return finalResult, nil
}

// executeDeepAgentFlowWithResult wraps executeDeepAgentFlow to also return
// the last activity result for callback result construction. The flow
// stores its result on w.lastActivityResult.
func (w *InvokeAgentExecutionWorkflowImpl) executeDeepAgentFlowWithResult(ctx workflow.Context, input *InvokeAgentExecutionWorkflowInput) (activities.RunnerActivityResult, error) {
	err := w.executeDeepAgentFlow(ctx, input)
	return w.lastActivityResult, err
}

// executeCursorFlowWithResult wraps executeCursorFlow to also return
// the last activity result for callback result construction. The flow
// stores its result on w.lastActivityResult.
func (w *InvokeAgentExecutionWorkflowImpl) executeCursorFlowWithResult(ctx workflow.Context, input *InvokeAgentExecutionWorkflowInput) (activities.RunnerActivityResult, error) {
	err := w.executeCursorFlow(ctx, input)
	return w.lastActivityResult, err
}

// buildCallbackResult constructs the result passed back to the parent
// workflow via async activity completion. Combines runner-extracted
// structured data with execution metadata.
func (w *InvokeAgentExecutionWorkflowImpl) buildCallbackResult(
	activityResult activities.RunnerActivityResult,
	execution *agentexecutionv1.AgentExecution,
) map[string]interface{} {
	result := map[string]interface{}{
		"agent_execution_id": execution.GetMetadata().GetId(),
	}

	// Pass through runner-extracted structured data.
	// The runner's slimStatus() returns proto-JSON with camelCase keys,
	// so the field is "structuredOutput" (camelCase). Also check
	// "structured_output" (snake_case) and "structured" for resilience.
	if activityResult != nil {
		if structured, ok := activityResult["structuredOutput"]; ok {
			result["structured"] = structured
		} else if structured, ok := activityResult["structured_output"]; ok {
			result["structured"] = structured
		} else if structured, ok := activityResult["structured"]; ok {
			result["structured"] = structured
		}
		if finalText, ok := activityResult["final_text"]; ok {
			result["final_text"] = finalText
		}
	}

	// Fallback: if structured output wasn't in the activity result,
	// read from the persisted execution status (populated via updateStatus gRPC).
	if _, hasStructured := result["structured"]; !hasStructured {
		if so := execution.GetStatus().GetStructuredOutput(); so != nil {
			result["structured"] = so.AsMap()
		}
	}

	// Add usage summary from the execution status
	streamingUsage := execution.GetStatus().GetStreamingUsage()
	if streamingUsage != nil {
		result["usage_summary"] = map[string]interface{}{
			"total_tokens":       streamingUsage.GetTotalTokens(),
			"estimated_cost_usd": streamingUsage.GetEstimatedCostUsd(),
		}
	}

	return result
}

// readHarnessStateId reads the harness_state_id from a session via local activity.
func (w *InvokeAgentExecutionWorkflowImpl) readHarnessStateId(ctx workflow.Context, sessionID string) (string, error) {
	localCtx := workflow.WithLocalActivityOptions(ctx, workflow.LocalActivityOptions{
		ScheduleToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
			InitialInterval: 2 * time.Second,
		},
	})

	var harnessStateID string
	err := workflow.ExecuteLocalActivity(localCtx, activities.ReadHarnessStateIdActivityName, sessionID).Get(localCtx, &harnessStateID)
	if err != nil {
		return "", fmt.Errorf("read session harness_state_id for %s: %w", sessionID, err)
	}
	return harnessStateID, nil
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
	return "stigmer_runner"
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

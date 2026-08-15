package workflows

import (
	"fmt"
	"time"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	ecactivities "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/executioncontext/temporal/activities"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/activities"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/runnerfailure"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// InvokeWorkflowExecutionWorkflowImpl implements InvokeWorkflowExecutionWorkflow.
//
// Unified Runner Architecture:
//   - Workflow (Go): Orchestrates child workflow execution on "workflow_execution_stigmer" queue
//   - TS unified runner: Polls the runner task queue and exposes
//     "stigmer/workflow/execute-from-execution" as a Temporal child workflow
//
// Signal handling: pause, resume, and relaySignal signals are forwarded from
// this orchestrator to the TS child workflow via SignalExternalWorkflow.
//
// The workflow:
// 1. Starts signal handler goroutines (pause, resume, relaySignal)
// 2. Executes the TS child workflow (version-gated for deterministic replay)
// 3. Handles cancellation/failure with status updates and EC cleanup
//
// Status Update Strategy:
// - Real-time updates: gRPC calls from TS runner to stigmer-server
// - Final state: Returned to workflow (for Temporal observability)
//
// Slim-Input Pattern:
// - Go workflow receives slim orchestration coordinates (execution_id, IDs, org_id)
// - TS child workflow hydrates full context via gRPC
// - Secrets (runtime_env) are kept out of Temporal's durable workflow history
type InvokeWorkflowExecutionWorkflowImpl struct{}

// RelaySignalPayload carries an arbitrary signal to be forwarded to the child workflow.
// Used by signal-receiving tasks (human_input, listen) that register signal channels
// in the TS child workflow. Exported so that controller handlers (SubmitWorkflowTaskApproval,
// SendSignal) can construct relay payloads for SignalWithStart calls.
type RelaySignalPayload struct {
	SignalName string      `json:"signalName"`
	Payload    interface{} `json:"payload"`
}

// Run implements InvokeWorkflowExecutionWorkflow.Run
func (w *InvokeWorkflowExecutionWorkflowImpl) Run(ctx workflow.Context, input *activities.InvokeWorkflowExecutionWorkflowInput) error {
	logger := workflow.GetLogger(ctx)
	executionID := input.ExecutionID

	logger.Info("Starting workflow for execution", "execution_id", executionID)

	// Start signal handler goroutines for pause, resume, and relay
	w.startSignalHandlers(ctx, executionID)

	// Version gate for deterministic replay: existing workflow histories
	// that started before this migration will replay with version 0 (legacy
	// activity path). New workflows get version 1 (child workflow path).
	v := workflow.GetVersion(ctx, "child-workflow-migration", workflow.DefaultVersion, 1)

	if err := w.executeVersioned(ctx, v, input); err != nil {
		if temporal.IsCanceledError(ctx.Err()) {
			logger.Info("Workflow cancelled, running cancellation cleanup", "execution_id", executionID)
			w.handleCancellation(ctx, executionID)
			return err
		}

		logger.Error("Workflow execution failed", "execution_id", executionID, "error", err.Error())

		if statusErr := w.updateStatusOnFailure(ctx, executionID, err); statusErr != nil {
			logger.Error("Failed to update execution status", "error", statusErr.Error())
		}

		w.deleteExecutionContext(ctx, executionID)
		return temporal.NewApplicationError("Workflow execution failed", "", err)
	}

	logger.Info("Workflow completed for execution (status updates were sent progressively via gRPC)", "execution_id", executionID)

	w.deleteExecutionContext(ctx, executionID)
	return nil
}

// startSignalHandlers launches goroutines to handle pause, resume, and relay
// signals, forwarding each to the TS child workflow via SignalExternalWorkflow.
//
// This mirrors the Java @SignalMethod handlers (pause, resume, relaySignal) on
// InvokeWorkflowExecutionWorkflow, adapted for Go's channel-based signal pattern.
//
// Pause and resume are handled by a SINGLE goroutine driven by a Selector so
// that their relays to the child can never be reordered. Both signals mutate the
// same `paused` flag in the TS child, so a resume that overtakes its preceding
// pause would leave the child blocked forever (the engine waits on
// condition(() => !paused)) until the workflow times out. Using two independent
// goroutines reorders them in practice: each relay is preceded by a
// status-update local activity whose latency varies, so a fast resume relay can
// be issued before a slow pause relay. The Selector serializes processing —
// each signal's status update and relay complete before the next signal is read
// — which preserves arrival order (pause is registered first, so it also wins
// ties when both are buffered in the same workflow task).
//
// Determinism note: signal-receiver goroutines emit no Temporal commands until a
// signal is actually processed, so for the common case (no pause/resume ever
// received) this structure produces identical history to independent goroutines.
func (w *InvokeWorkflowExecutionWorkflowImpl) startSignalHandlers(ctx workflow.Context, executionID string) {
	pauseCh := workflow.GetSignalChannel(ctx, SignalPause)
	resumeCh := workflow.GetSignalChannel(ctx, SignalResume)
	workflow.Go(ctx, func(gCtx workflow.Context) {
		selector := workflow.NewSelector(gCtx)
		selector.AddReceive(pauseCh, func(c workflow.ReceiveChannel, _ bool) {
			var reason string
			c.Receive(gCtx, &reason)
			logger := workflow.GetLogger(gCtx)
			logger.Info("Pause signal received", "execution_id", executionID, "reason", reason)

			w.updateStatusToPaused(gCtx, executionID)
			w.relaySignalToChild(gCtx, executionID, SignalPause, reason)
		})
		selector.AddReceive(resumeCh, func(c workflow.ReceiveChannel, _ bool) {
			var ignored string
			c.Receive(gCtx, &ignored)
			logger := workflow.GetLogger(gCtx)
			logger.Info("Resume signal received", "execution_id", executionID)

			w.updateStatusToRunning(gCtx, executionID)
			w.relaySignalToChild(gCtx, executionID, SignalResume, nil)
		})
		for {
			selector.Select(gCtx)
		}
	})

	// Generic relay signal handler (for LISTEN/human_input tasks).
	// The API layer sends signals to this outer orchestrator via SignalWithStart;
	// this handler forwards them to the TS child workflow where task-specific
	// signal channels are registered.
	relayCh := workflow.GetSignalChannel(ctx, "relaySignal")
	workflow.Go(ctx, func(gCtx workflow.Context) {
		for {
			var payload RelaySignalPayload
			relayCh.Receive(gCtx, &payload)
			logger := workflow.GetLogger(gCtx)
			logger.Info("Relay signal received", "execution_id", executionID, "signal", payload.SignalName)

			w.relaySignalToChild(gCtx, executionID, payload.SignalName, payload.Payload)
		}
	})
}

// relaySignalToChild forwards a signal to the TS child workflow using
// SignalExternalWorkflow. The child workflow ID follows the convention
// "workflow-exec-{executionId}" which matches the Java implementation.
func (w *InvokeWorkflowExecutionWorkflowImpl) relaySignalToChild(ctx workflow.Context, executionID, signalName string, payload interface{}) {
	childWorkflowID := "workflow-exec-" + executionID
	logger := workflow.GetLogger(ctx)

	err := workflow.SignalExternalWorkflow(ctx, childWorkflowID, "", signalName, payload).Get(ctx, nil)
	if err != nil {
		logger.Warn("Failed to relay signal to child workflow",
			"execution_id", executionID,
			"signal", signalName,
			"child_workflow_id", childWorkflowID,
			"error", err.Error())
	}
}

// executeVersioned dispatches to the child workflow (v1) or legacy activity (v0)
// based on the workflow version. This preserves deterministic replay for
// workflows that were started before the child-workflow migration.
func (w *InvokeWorkflowExecutionWorkflowImpl) executeVersioned(ctx workflow.Context, version workflow.Version, input *activities.InvokeWorkflowExecutionWorkflowInput) error {
	if version >= 1 {
		return w.executeChildWorkflow(ctx, input)
	}
	return w.executeLegacyActivity(ctx, input)
}

// executeChildWorkflow starts the TS unified runner's workflow as a Temporal
// child workflow. The child handles the actual CNCF Serverless Workflow
// execution and reports progressive status updates via gRPC.
func (w *InvokeWorkflowExecutionWorkflowImpl) executeChildWorkflow(ctx workflow.Context, input *activities.InvokeWorkflowExecutionWorkflowInput) error {
	executionID := input.ExecutionID
	childWorkflowID := "workflow-exec-" + executionID
	taskQueue := w.getRunnerTaskQueue(ctx)

	childCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
		WorkflowID:        childWorkflowID,
		TaskQueue:         taskQueue,
		ParentClosePolicy: enumspb.PARENT_CLOSE_POLICY_REQUEST_CANCEL,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 1,
		},
	})

	logger := workflow.GetLogger(ctx)
	logger.Info("Starting child workflow",
		"execution_id", executionID,
		"child_workflow_id", childWorkflowID,
		"task_queue", taskQueue)

	return workflow.ExecuteChildWorkflow(childCtx, "stigmer/workflow/execute-from-execution", input).Get(childCtx, nil)
}

// executeLegacyActivity preserves the old activity-based path for version 0
// workflows that are replaying from history. The Go workflow-runner has been
// deleted, so any new workflow starting this path will timeout on
// ScheduleToStart (no worker polls the old queue).
func (w *InvokeWorkflowExecutionWorkflowImpl) executeLegacyActivity(ctx workflow.Context, input *activities.InvokeWorkflowExecutionWorkflowInput) error {
	logger := workflow.GetLogger(ctx)
	executionID := input.ExecutionID

	logger.Info("Legacy activity path (version 0)", "execution_id", executionID)

	activityTaskQueue := w.getRunnerTaskQueue(ctx)

	executeWorkflowActivity := activities.NewExecuteWorkflowActivityStub(ctx, activityTaskQueue)
	finalStatus, err := executeWorkflowActivity.ExecuteWorkflow(input)
	if err != nil {
		return fmt.Errorf("failed to execute workflow: %w", err)
	}

	if finalStatus == nil {
		logger.Error("ExecuteWorkflow returned NULL status", "execution_id", executionID)
		return fmt.Errorf("activity returned null status - this should never happen")
	}

	logger.Info("Legacy execution completed - final status received",
		"tasks", len(finalStatus.GetTasks()),
		"phase", finalStatus.GetPhase().String())

	return nil
}

// getRunnerTaskQueue retrieves the runner task queue from workflow memo.
// Tries the new "runnerTaskQueue" key first, falls back to the legacy
// "activityTaskQueue" key for backward compatibility with in-flight workflows.
//
// Returns: Runner task queue name (defaults to "stigmer_runner")
func (w *InvokeWorkflowExecutionWorkflowImpl) getRunnerTaskQueue(ctx workflow.Context) string {
	info := workflow.GetInfo(ctx)

	if info.Memo != nil && info.Memo.Fields != nil {
		// New key (post-migration)
		if field, ok := info.Memo.Fields["runnerTaskQueue"]; ok {
			var queue string
			if err := converter.GetDefaultDataConverter().FromPayload(field, &queue); err == nil && queue != "" {
				return queue
			}
		}
		// Legacy key (pre-migration in-flight workflows)
		if field, ok := info.Memo.Fields["activityTaskQueue"]; ok {
			var queue string
			if err := converter.GetDefaultDataConverter().FromPayload(field, &queue); err == nil && queue != "" {
				return queue
			}
		}
	}

	return "stigmer_runner"
}

// updateStatusToPaused updates the execution status to PAUSED.
// Best-effort: logs on error but never propagates.
func (w *InvokeWorkflowExecutionWorkflowImpl) updateStatusToPaused(ctx workflow.Context, executionID string) {
	logger := workflow.GetLogger(ctx)

	pausedStatus := &workflowexecutionv1.WorkflowExecutionStatus{
		Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_PAUSED,
	}

	localCtx := workflow.WithLocalActivityOptions(ctx, workflow.LocalActivityOptions{
		ScheduleToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
			InitialInterval: 2 * time.Second,
		},
	})

	err := workflow.ExecuteLocalActivity(localCtx, activities.UpdateWorkflowExecutionStatusActivityName, executionID, pausedStatus).Get(localCtx, nil)
	if err != nil {
		logger.Warn("Failed to update execution status to PAUSED",
			"execution_id", executionID, "error", err.Error())
		return
	}

	logger.Info("Updated execution status to PAUSED", "execution_id", executionID)
}

// updateStatusToRunning updates the execution status to IN_PROGRESS (running).
// Best-effort: logs on error but never propagates.
func (w *InvokeWorkflowExecutionWorkflowImpl) updateStatusToRunning(ctx workflow.Context, executionID string) {
	logger := workflow.GetLogger(ctx)

	runningStatus := &workflowexecutionv1.WorkflowExecutionStatus{
		Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
	}

	localCtx := workflow.WithLocalActivityOptions(ctx, workflow.LocalActivityOptions{
		ScheduleToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
			InitialInterval: 2 * time.Second,
		},
	})

	err := workflow.ExecuteLocalActivity(localCtx, activities.UpdateWorkflowExecutionStatusActivityName, executionID, runningStatus).Get(localCtx, nil)
	if err != nil {
		logger.Warn("Failed to update execution status to IN_PROGRESS",
			"execution_id", executionID, "error", err.Error())
		return
	}

	logger.Info("Updated execution status to IN_PROGRESS", "execution_id", executionID)
}

// updateStatusOnFailure updates the execution status to FAILED when a system error occurs.
//
// Uses a regular activity (not local) on the stigmer workflow queue for version >= 1.
// Local activities produce RECORD_MARKER events that trigger a Temporal SDK state machine
// bug when executed in the same workflow task as a child workflow failure event. Regular
// activities produce standard ActivityTaskScheduled/Completed events that replay safely.
//
// This mirrors the fix already applied to:
//   - Java workflow orchestrator (InvokeWorkflowExecutionWorkflowImpl.java, remote stubs)
//   - Go agent orchestrator (agentexecution/temporal/workflows/invoke_workflow_impl.go)
func (w *InvokeWorkflowExecutionWorkflowImpl) updateStatusOnFailure(ctx workflow.Context, executionID string, originalErr error) error {
	logger := workflow.GetLogger(ctx)

	logger.Info("Updating execution status to FAILED", "execution_id", executionID)

	// Recognized worker-shutdown shapes persist the honest platform-failure
	// copy instead of raw Temporal drain internals (#776) — same mapping as
	// the agentexecution twin, shared via pkg/runnerfailure. The raw text
	// stays in the workflow log (the caller already logged it).
	statusError := fmt.Sprintf("Workflow execution failed: %s", originalErr.Error())
	if runnerfailure.IsWorkerShutdown(originalErr) {
		statusError = runnerfailure.WorkerShutdownStatusError
	}

	failedStatus := &workflowexecutionv1.WorkflowExecutionStatus{
		Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED,
		Error: statusError,
	}

	v := workflow.GetVersion(ctx, "remote-cleanup-stubs", workflow.DefaultVersion, 1)

	var err error
	if v >= 1 {
		actCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
			ScheduleToCloseTimeout: 30 * time.Second,
			RetryPolicy: &temporal.RetryPolicy{
				MaximumAttempts: 3,
				InitialInterval: 2 * time.Second,
			},
		})
		err = workflow.ExecuteActivity(actCtx, activities.UpdateWorkflowExecutionStatusActivityName, executionID, failedStatus).Get(actCtx, nil)
	} else {
		localCtx := workflow.WithLocalActivityOptions(ctx, workflow.LocalActivityOptions{
			ScheduleToCloseTimeout: 30 * time.Second,
			RetryPolicy: &temporal.RetryPolicy{
				MaximumAttempts: 3,
				InitialInterval: 2 * time.Second,
			},
		})
		err = workflow.ExecuteLocalActivity(localCtx, activities.UpdateWorkflowExecutionStatusActivityName, executionID, failedStatus).Get(localCtx, nil)
	}

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
// logged but never propagated.
func (w *InvokeWorkflowExecutionWorkflowImpl) handleCancellation(ctx workflow.Context, executionID string) {
	cleanupCtx, cancel := workflow.NewDisconnectedContext(ctx)
	defer cancel()

	w.updateStatusOnCancellation(cleanupCtx, executionID)
	w.deleteExecutionContext(cleanupCtx, executionID)
}

// updateStatusOnCancellation updates the execution status to CANCELLED.
// Uses remote activity (v1) to avoid RECORD_MARKER replay bugs on the cancel path.
// Best-effort: logs on error but never propagates.
//
// Deliberately sets NO error: a user-initiated cancel is a quiet terminal
// state, not a failure (stigmer#282). The proto contract populates
// status.error only for FAILED executions, and display layers key error
// styling on it — writing a sentinel here would render the stop as a
// failure. The CANCELLED phase alone carries the state.
func (w *InvokeWorkflowExecutionWorkflowImpl) updateStatusOnCancellation(ctx workflow.Context, executionID string) {
	logger := workflow.GetLogger(ctx)

	cancelledStatus := &workflowexecutionv1.WorkflowExecutionStatus{
		Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED,
	}

	v := workflow.GetVersion(ctx, "remote-cleanup-stubs", workflow.DefaultVersion, 1)

	var err error
	if v >= 1 {
		actCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
			ScheduleToCloseTimeout: 30 * time.Second,
			RetryPolicy: &temporal.RetryPolicy{
				MaximumAttempts: 3,
				InitialInterval: 2 * time.Second,
			},
		})
		err = workflow.ExecuteActivity(actCtx, activities.UpdateWorkflowExecutionStatusActivityName, executionID, cancelledStatus).Get(actCtx, nil)
	} else {
		localCtx := workflow.WithLocalActivityOptions(ctx, workflow.LocalActivityOptions{
			ScheduleToCloseTimeout: 30 * time.Second,
			RetryPolicy: &temporal.RetryPolicy{
				MaximumAttempts: 3,
				InitialInterval: 2 * time.Second,
			},
		})
		err = workflow.ExecuteLocalActivity(localCtx, activities.UpdateWorkflowExecutionStatusActivityName, executionID, cancelledStatus).Get(localCtx, nil)
	}

	if err != nil {
		logger.Warn("Failed to update execution status to CANCELLED",
			"execution_id", executionID, "error", err.Error())
		return
	}

	logger.Info("Updated execution status to CANCELLED", "execution_id", executionID)
}

// deleteExecutionContext deletes the ephemeral ExecutionContext that was created
// during execution setup. The ExecutionContext holds the fully-merged environment
// (including secrets) and must be cleaned up when the workflow finishes.
//
// Uses workflow.NewDisconnectedContext so cleanup runs even if the workflow was
// cancelled. Uses remote activity (v1) on failure/cancel paths to avoid
// RECORD_MARKER replay bugs. Errors are logged but never propagated -- cleanup
// is best-effort with TTL-based backup for orphaned contexts.
func (w *InvokeWorkflowExecutionWorkflowImpl) deleteExecutionContext(ctx workflow.Context, executionID string) {
	logger := workflow.GetLogger(ctx)

	cleanupCtx, cancel := workflow.NewDisconnectedContext(ctx)
	defer cancel()

	v := workflow.GetVersion(cleanupCtx, "remote-cleanup-stubs", workflow.DefaultVersion, 1)

	var err error
	if v >= 1 {
		actCtx := workflow.WithActivityOptions(cleanupCtx, workflow.ActivityOptions{
			ScheduleToCloseTimeout: 30 * time.Second,
			RetryPolicy: &temporal.RetryPolicy{
				MaximumAttempts: 3,
				InitialInterval: 2 * time.Second,
			},
		})
		err = workflow.ExecuteActivity(actCtx,
			ecactivities.DeleteExecutionContextActivityName, executionID,
		).Get(actCtx, nil)
	} else {
		localCtx := workflow.WithLocalActivityOptions(cleanupCtx, workflow.LocalActivityOptions{
			ScheduleToCloseTimeout: 30 * time.Second,
			RetryPolicy: &temporal.RetryPolicy{
				MaximumAttempts: 3,
				InitialInterval: 2 * time.Second,
			},
		})
		err = workflow.ExecuteLocalActivity(localCtx,
			ecactivities.DeleteExecutionContextActivityName, executionID,
		).Get(localCtx, nil)
	}

	if err != nil {
		logger.Warn("ExecutionContext cleanup failed (will rely on TTL backup)",
			"execution_id", executionID, "error", err.Error())
		return
	}

	logger.Info("ExecutionContext cleaned up", "execution_id", executionID)
}

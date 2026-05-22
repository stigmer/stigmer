package workflowexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
)

// Pause pauses a running workflow execution.
//
// This RPC sends a pause signal to the workflow via Temporal's SignalWorkflow API.
// The workflow receives the signal, gracefully cancels any running activities
// (allowing them to checkpoint), and waits for a resume signal.
//
// Unlike cancel, the execution is NOT terminal and can be resumed later.
// The workflow engine pauses at the next task boundary via Temporal signal.
// Completed tasks are preserved in Temporal workflow history and are not re-executed on resume.
//
// Pipeline Steps:
// 1. LoadExecutionById - Load execution from database
// 2. ValidatePausable - Check phase is PENDING or IN_PROGRESS (or already PAUSED for idempotency)
// 3. SignalPauseToTemporal - Send pause signal to Temporal workflow
// 4. UpdateExecutionPhase - Set phase to PAUSED (no completed_at since not terminal)
// 5. PersistExecution - Save to database
// 6. BroadcastExecutionUpdate - Publish to StreamBroker for real-time subscribers
//
// Idempotency:
// If the execution is already paused, the call succeeds as a no-op.
//
// Error Cases:
// - NOT_FOUND: Execution with given ID doesn't exist
// - FAILED_PRECONDITION: Execution is in a terminal phase (COMPLETED, FAILED, CANCELLED, TERMINATED)
// - INVALID_ARGUMENT: ID is empty or malformed
func (c *WorkflowExecutionController) Pause(
	ctx context.Context,
	input *workflowexecutionv1.PauseWorkflowExecutionInput,
) (*workflowexecutionv1.WorkflowExecution, error) {
	log.Info().
		Str("execution_id", input.GetId()).
		Str("reason", input.GetReason()).
		Msg("Pause workflow execution request")

	// Create request context with the input
	reqCtx := pipeline.NewRequestContext(ctx, input)

	// Build and execute pipeline
	p := c.buildPausePipeline()
	if err := p.Execute(reqCtx); err != nil {
		log.Warn().
			Str("execution_id", input.GetId()).
			Err(err).
			Msg("Pause workflow execution failed")
		return nil, err
	}

	// Get execution from context
	execution := reqCtx.Get(LoadedExecutionKey)
	if execution == nil {
		return nil, grpclib.InternalError(nil, "execution not found in context after pause pipeline")
	}

	log.Info().
		Str("execution_id", input.GetId()).
		Str("phase", execution.(*workflowexecutionv1.WorkflowExecution).GetStatus().GetPhase().String()).
		Msg("Pause workflow execution completed")

	return execution.(*workflowexecutionv1.WorkflowExecution), nil
}

// buildPausePipeline constructs the pipeline for pause operations
func (c *WorkflowExecutionController) buildPausePipeline() *pipeline.Pipeline[*workflowexecutionv1.PauseWorkflowExecutionInput] {
	return pipeline.NewPipeline[*workflowexecutionv1.PauseWorkflowExecutionInput]("workflowexecution-pause").
		AddStep(NewLoadExecutionByIdStep[*workflowexecutionv1.PauseWorkflowExecutionInput](c.store)).
		AddStep(NewValidatePausableStep[*workflowexecutionv1.PauseWorkflowExecutionInput]()).
		AddStep(NewSignalPauseToTemporalStep[*workflowexecutionv1.PauseWorkflowExecutionInput](c.temporalClient)).
		AddStep(NewUpdateExecutionPhaseStep[*workflowexecutionv1.PauseWorkflowExecutionInput](
			workflowexecutionv1.ExecutionPhase_EXECUTION_PAUSED,
			false, // don't set error
			false, // don't clear error
		)).
		AddStep(NewLifecyclePersistStep[*workflowexecutionv1.PauseWorkflowExecutionInput](c.store)).
		AddStep(NewLifecycleBroadcastStep[*workflowexecutionv1.PauseWorkflowExecutionInput](c.streamBroker)).
		Build()
}

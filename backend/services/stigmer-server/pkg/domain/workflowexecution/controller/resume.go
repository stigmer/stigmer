package workflowexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
)

// Resume resumes a paused workflow execution.
//
// This RPC sends a resume signal to the workflow via Temporal's SignalWorkflow API.
// The outer orchestrator forwards the signal to the TS child workflow, which
// unblocks the engine's condition() and continues execution from the next task.
//
// This operation is only valid for executions in EXECUTION_PAUSED phase.
//
// Pipeline Steps:
// 1. LoadExecutionById - Load execution from database
// 2. ValidateResumable - Check phase is PAUSED (or already IN_PROGRESS for idempotency)
// 3. SignalResumeToTemporal - Send resume signal to Temporal workflow
// 4. UpdateExecutionPhase - Set phase to IN_PROGRESS
// 5. PersistExecution - Save to database
// 6. BroadcastExecutionUpdate - Publish to StreamBroker for real-time subscribers
//
// Idempotency:
// If the execution is already in progress, the call succeeds as a no-op.
//
// Error Cases:
// - NOT_FOUND: Execution with given ID doesn't exist
// - FAILED_PRECONDITION: Execution is not in PAUSED phase
// - INVALID_ARGUMENT: ID is empty or malformed
func (c *WorkflowExecutionController) Resume(
	ctx context.Context,
	input *workflowexecutionv1.ResumeWorkflowExecutionInput,
) (*workflowexecutionv1.WorkflowExecution, error) {
	log.Info().
		Str("execution_id", input.GetId()).
		Msg("Resume workflow execution request")

	// Create request context with the input
	reqCtx := pipeline.NewRequestContext(ctx, input)

	// Build and execute pipeline
	p := c.buildResumePipeline()
	if err := p.Execute(reqCtx); err != nil {
		log.Warn().
			Str("execution_id", input.GetId()).
			Err(err).
			Msg("Resume workflow execution failed")
		return nil, err
	}

	// Get execution from context
	execution := reqCtx.Get(LoadedExecutionKey)
	if execution == nil {
		return nil, grpclib.InternalError(nil, "execution not found in context after resume pipeline")
	}

	log.Info().
		Str("execution_id", input.GetId()).
		Str("phase", execution.(*workflowexecutionv1.WorkflowExecution).GetStatus().GetPhase().String()).
		Msg("Resume workflow execution completed")

	return execution.(*workflowexecutionv1.WorkflowExecution), nil
}

// buildResumePipeline constructs the pipeline for resume operations
func (c *WorkflowExecutionController) buildResumePipeline() *pipeline.Pipeline[*workflowexecutionv1.ResumeWorkflowExecutionInput] {
	return pipeline.NewPipeline[*workflowexecutionv1.ResumeWorkflowExecutionInput]("workflowexecution-resume").
		AddStep(NewLoadExecutionByIdStep[*workflowexecutionv1.ResumeWorkflowExecutionInput](c.store)).
		AddStep(NewValidateResumableStep[*workflowexecutionv1.ResumeWorkflowExecutionInput]()).
		AddStep(NewSignalResumeToTemporalStep[*workflowexecutionv1.ResumeWorkflowExecutionInput](c.temporalClient)).
		AddStep(NewUpdateExecutionPhaseStep[*workflowexecutionv1.ResumeWorkflowExecutionInput](
			workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			false, // don't set error
			false, // don't clear error
		)).
		AddStep(NewLifecyclePersistStep[*workflowexecutionv1.ResumeWorkflowExecutionInput](c.store)).
		AddStep(NewLifecycleBroadcastStep[*workflowexecutionv1.ResumeWorkflowExecutionInput](c.streamBroker)).
		Build()
}

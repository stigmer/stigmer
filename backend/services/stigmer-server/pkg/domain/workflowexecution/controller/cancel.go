package workflowexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
)

// Cancel cancels a running workflow execution gracefully.
//
// This RPC sends a cancellation signal to the workflow via Temporal's CancelWorkflow API.
// The workflow code can handle the cancellation signal to perform cleanup
// (e.g., compensation logic, resource cleanup, notifications) before
// transitioning to the CANCELLED phase.
//
// Pipeline Steps:
// 1. LoadExecutionById - Load execution from database
// 2. ValidateCancellable - Check phase is PENDING or IN_PROGRESS (or already CANCELLED for idempotency)
// 3. CancelTemporalWorkflow - Send cancellation signal to Temporal
// 4. UpdateExecutionPhase - Set phase to CANCELLED, set completed_at
// 5. PersistExecution - Save to database
// 6. BroadcastExecutionUpdate - Publish to StreamBroker for real-time subscribers
//
// Idempotency:
// If the execution is already cancelled, the call succeeds as a no-op.
//
// Error Cases:
// - NOT_FOUND: Execution with given ID doesn't exist
// - FAILED_PRECONDITION: Execution is in a terminal phase (COMPLETED, FAILED, TERMINATED)
// - INVALID_ARGUMENT: ID is empty or malformed
func (c *WorkflowExecutionController) Cancel(
	ctx context.Context,
	input *workflowexecutionv1.CancelWorkflowExecutionInput,
) (*workflowexecutionv1.WorkflowExecution, error) {
	log.Info().
		Str("execution_id", input.GetId()).
		Str("reason", input.GetReason()).
		Msg("Cancel workflow execution request")

	// Create request context with the input
	reqCtx := pipeline.NewRequestContext(ctx, input)

	// Build and execute pipeline
	p := c.buildCancelPipeline()
	if err := p.Execute(reqCtx); err != nil {
		log.Warn().
			Str("execution_id", input.GetId()).
			Err(err).
			Msg("Cancel workflow execution failed")
		return nil, err
	}

	// Get execution from context
	execution := reqCtx.Get(LoadedExecutionKey)
	if execution == nil {
		return nil, grpclib.InternalError(nil, "execution not found in context after cancel pipeline")
	}

	log.Info().
		Str("execution_id", input.GetId()).
		Str("phase", execution.(*workflowexecutionv1.WorkflowExecution).GetStatus().GetPhase().String()).
		Msg("Cancel workflow execution completed")

	return execution.(*workflowexecutionv1.WorkflowExecution), nil
}

// buildCancelPipeline constructs the pipeline for cancel operations
func (c *WorkflowExecutionController) buildCancelPipeline() *pipeline.Pipeline[*workflowexecutionv1.CancelWorkflowExecutionInput] {
	return pipeline.NewPipeline[*workflowexecutionv1.CancelWorkflowExecutionInput]("workflowexecution-cancel").
		AddStep(NewLoadExecutionByIdStep[*workflowexecutionv1.CancelWorkflowExecutionInput](c.store)).
		AddStep(NewValidateCancellableStep[*workflowexecutionv1.CancelWorkflowExecutionInput]()).
		AddStep(NewCancelTemporalWorkflowStep[*workflowexecutionv1.CancelWorkflowExecutionInput](c.temporalClient)).
		AddStep(NewUpdateExecutionPhaseStep[*workflowexecutionv1.CancelWorkflowExecutionInput](
			workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED,
			false, // don't set error
			false, // don't clear error
		)).
		AddStep(NewLifecyclePersistStep[*workflowexecutionv1.CancelWorkflowExecutionInput](c.store)).
		AddStep(NewLifecycleBroadcastStep[*workflowexecutionv1.CancelWorkflowExecutionInput](c.streamBroker)).
		Build()
}

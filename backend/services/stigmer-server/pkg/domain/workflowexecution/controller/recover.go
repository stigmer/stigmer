package workflowexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
)

// Recover recovers a failed workflow execution from the last checkpoint.
//
// This RPC resumes execution from the last successful point using Temporal's
// ResetWorkflow API. Completed work is preserved - successful tasks
// are NOT re-executed. This enables "retry and resume" semantics
// without duplicating side effects.
//
// Pipeline Steps:
// 1. LoadExecutionById - Load execution from database
// 2. ValidateRecoverable - Check phase is FAILED (not TERMINATED/CANCELLED)
// 3. ResetTemporalWorkflow - Query history, find reset point, call reset API
// 4. UpdateExecutionPhase - Set phase to IN_PROGRESS, clear error/completed_at
// 5. PersistExecution - Save to database
// 6. BroadcastExecutionUpdate - Publish to StreamBroker for real-time subscribers
//
// Idempotency:
// If recovery already succeeded (execution is now IN_PROGRESS from a
// previous recover call), the call succeeds as a no-op and returns
// the current execution state.
//
// Error Cases:
// - NOT_FOUND: Execution with given ID doesn't exist
// - FAILED_PRECONDITION: Execution is not in FAILED phase, or is TERMINATED/CANCELLED
// - INVALID_ARGUMENT: ID is empty or malformed
func (c *WorkflowExecutionController) Recover(
	ctx context.Context,
	input *workflowexecutionv1.RecoverWorkflowExecutionInput,
) (*workflowexecutionv1.WorkflowExecution, error) {
	log.Info().
		Str("execution_id", input.GetId()).
		Str("reason", input.GetReason()).
		Msg("Recover workflow execution request")

	// Create request context with the input
	reqCtx := pipeline.NewRequestContext(ctx, input)

	// Build and execute pipeline
	p := c.buildRecoverPipeline()
	if err := p.Execute(reqCtx); err != nil {
		log.Warn().
			Str("execution_id", input.GetId()).
			Err(err).
			Msg("Recover workflow execution failed")
		return nil, err
	}

	// Get execution from context
	execution := reqCtx.Get(LoadedExecutionKey)
	if execution == nil {
		return nil, grpclib.InternalError(nil, "execution not found in context after recover pipeline")
	}

	log.Info().
		Str("execution_id", input.GetId()).
		Str("phase", execution.(*workflowexecutionv1.WorkflowExecution).GetStatus().GetPhase().String()).
		Msg("Recover workflow execution completed")

	return execution.(*workflowexecutionv1.WorkflowExecution), nil
}

// buildRecoverPipeline constructs the pipeline for recover operations
func (c *WorkflowExecutionController) buildRecoverPipeline() *pipeline.Pipeline[*workflowexecutionv1.RecoverWorkflowExecutionInput] {
	// Get namespace from config (defaults to "default")
	namespace := GetTemporalNamespace()

	return pipeline.NewPipeline[*workflowexecutionv1.RecoverWorkflowExecutionInput]("workflowexecution-recover").
		AddStep(NewLoadExecutionByIdStep[*workflowexecutionv1.RecoverWorkflowExecutionInput](c.store)).
		AddStep(NewValidateRecoverableStep[*workflowexecutionv1.RecoverWorkflowExecutionInput]()).
		AddStep(NewResetTemporalWorkflowStep[*workflowexecutionv1.RecoverWorkflowExecutionInput](c.temporalClient, namespace)).
		AddStep(NewUpdateExecutionPhaseStep[*workflowexecutionv1.RecoverWorkflowExecutionInput](
			workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			false, // don't set error
			true,  // clear error (recovering from failure)
		)).
		AddStep(NewLifecyclePersistStep[*workflowexecutionv1.RecoverWorkflowExecutionInput](c.store)).
		AddStep(NewLifecycleBroadcastStep[*workflowexecutionv1.RecoverWorkflowExecutionInput](c.streamBroker)).
		Build()
}

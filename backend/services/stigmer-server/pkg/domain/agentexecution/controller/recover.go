package agentexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
)

// Recover recovers a failed agent execution from the last checkpoint.
//
// This RPC resumes execution from the last LangGraph checkpoint using Temporal's
// ResetWorkflow API. Completed work is preserved - successful tool calls
// are NOT re-executed.
//
// Pipeline Steps:
// 1. LoadExecutionById - Load execution from database
// 2. ValidateRecoverable - Check phase is FAILED (or already IN_PROGRESS for idempotency)
// 3. ResetTemporalWorkflow - Reset to last checkpoint via Temporal
// 4. UpdateExecutionPhase - Set phase to IN_PROGRESS, clear error and completed_at
// 5. PersistExecution - Save to database
// 6. BroadcastExecutionUpdate - Publish to StreamBroker for real-time subscribers
//
// Idempotency:
// If recovery already succeeded (execution is now IN_PROGRESS), the call succeeds as a no-op.
//
// Error Cases:
// - NOT_FOUND: Execution with given ID doesn't exist
// - FAILED_PRECONDITION: Execution is not in FAILED phase (TERMINATED/CANCELLED cannot be recovered)
// - INVALID_ARGUMENT: ID is empty or malformed
func (c *AgentExecutionController) Recover(
	ctx context.Context,
	input *agentexecutionv1.RecoverAgentExecutionInput,
) (*agentexecutionv1.AgentExecution, error) {
	log.Info().
		Str("execution_id", input.GetId()).
		Msg("Recover agent execution request")

	// Create request context with the input
	reqCtx := pipeline.NewRequestContext(ctx, input)

	// Build and execute pipeline
	p := c.buildRecoverPipeline()
	if err := p.Execute(reqCtx); err != nil {
		log.Warn().
			Str("execution_id", input.GetId()).
			Err(err).
			Msg("Recover agent execution failed")
		return nil, err
	}

	// Get execution from context
	execution := reqCtx.Get(LoadedExecutionKey)
	if execution == nil {
		return nil, grpclib.InternalError(nil, "execution not found in context after recover pipeline")
	}

	log.Info().
		Str("execution_id", input.GetId()).
		Str("phase", execution.(*agentexecutionv1.AgentExecution).GetStatus().GetPhase().String()).
		Msg("Recover agent execution completed")

	return execution.(*agentexecutionv1.AgentExecution), nil
}

// buildRecoverPipeline constructs the pipeline for recover operations
func (c *AgentExecutionController) buildRecoverPipeline() *pipeline.Pipeline[*agentexecutionv1.RecoverAgentExecutionInput] {
	return pipeline.NewPipeline[*agentexecutionv1.RecoverAgentExecutionInput]("agentexecution-recover").
		AddStep(NewLoadExecutionByIdStep[*agentexecutionv1.RecoverAgentExecutionInput](c.store)).
		AddStep(NewValidateRecoverableStep[*agentexecutionv1.RecoverAgentExecutionInput]()).
		AddStep(NewResetTemporalWorkflowStep[*agentexecutionv1.RecoverAgentExecutionInput](c.temporalClient, GetTemporalNamespace())).
		AddStep(NewUpdateExecutionPhaseAndPersistStep[*agentexecutionv1.RecoverAgentExecutionInput](
			c.store,
			agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			false, // don't set error
			true,  // clear error on recovery
		)).
		AddStep(NewLifecycleBroadcastStep[*agentexecutionv1.RecoverAgentExecutionInput](c.streamBroker)).
		Build()
}

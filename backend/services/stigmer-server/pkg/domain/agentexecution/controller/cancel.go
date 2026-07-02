package agentexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
)

// Cancel cancels a running agent execution gracefully.
//
// This RPC sends a cancellation signal to the agent execution via Temporal's CancelWorkflow API.
// The agent can handle the cancellation signal to save checkpoint and clean up
// before transitioning to the CANCELLED phase.
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
func (c *AgentExecutionController) Cancel(
	ctx context.Context,
	input *agentexecutionv1.CancelAgentExecutionInput,
) (*agentexecutionv1.AgentExecution, error) {
	log.Info().
		Str("execution_id", input.GetId()).
		Str("reason", input.GetReason()).
		Msg("Cancel agent execution request")

	// Create request context with the input
	reqCtx := pipeline.NewRequestContext(ctx, input)

	// Build and execute pipeline
	p := c.buildCancelPipeline()
	if err := p.Execute(reqCtx); err != nil {
		log.Warn().
			Str("execution_id", input.GetId()).
			Err(err).
			Msg("Cancel agent execution failed")
		return nil, err
	}

	// Get execution from context
	execution := reqCtx.Get(LoadedExecutionKey)
	if execution == nil {
		return nil, grpclib.InternalError(nil, "execution not found in context after cancel pipeline")
	}

	log.Info().
		Str("execution_id", input.GetId()).
		Str("phase", execution.(*agentexecutionv1.AgentExecution).GetStatus().GetPhase().String()).
		Msg("Cancel agent execution completed")

	return execution.(*agentexecutionv1.AgentExecution), nil
}

// buildCancelPipeline constructs the pipeline for cancel operations
func (c *AgentExecutionController) buildCancelPipeline() *pipeline.Pipeline[*agentexecutionv1.CancelAgentExecutionInput] {
	return pipeline.NewPipeline[*agentexecutionv1.CancelAgentExecutionInput]("agentexecution-cancel").
		AddStep(NewLoadExecutionByIdStep[*agentexecutionv1.CancelAgentExecutionInput](c.store)).
		AddStep(NewValidateCancellableStep[*agentexecutionv1.CancelAgentExecutionInput]()).
		AddStep(NewCancelTemporalWorkflowStep[*agentexecutionv1.CancelAgentExecutionInput](c.temporalClient)).
		AddStep(NewUpdateExecutionPhaseAndPersistStep[*agentexecutionv1.CancelAgentExecutionInput](
			c.store,
			agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED,
			false, // don't set error
			false, // don't clear error
		)).
		AddStep(NewLifecycleBroadcastStep[*agentexecutionv1.CancelAgentExecutionInput](c.streamBroker)).
		Build()
}

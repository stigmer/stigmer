package agentexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
)

// Pause pauses a running agent execution.
//
// This RPC temporarily stops the agent at its current checkpoint. Unlike cancel,
// the execution is NOT terminal and can be resumed later from where it left off.
//
// Pipeline Steps:
// 1. LoadExecutionById - Load execution from database
// 2. ValidatePausable - Check phase is PENDING or IN_PROGRESS (or already PAUSED for idempotency)
// 3. SignalPauseToTemporal - Send pause signal to workflow
// 4. UpdateExecutionPhase - Set phase to PAUSED (don't set completed_at - execution is not finished)
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
func (c *AgentExecutionController) Pause(
	ctx context.Context,
	input *agentexecutionv1.PauseAgentExecutionInput,
) (*agentexecutionv1.AgentExecution, error) {
	log.Info().
		Str("execution_id", input.GetId()).
		Str("reason", input.GetReason()).
		Msg("Pause agent execution request")

	// Create request context with the input
	reqCtx := pipeline.NewRequestContext(ctx, input)

	// Build and execute pipeline
	p := c.buildPausePipeline()
	if err := p.Execute(reqCtx); err != nil {
		log.Warn().
			Str("execution_id", input.GetId()).
			Err(err).
			Msg("Pause agent execution failed")
		return nil, err
	}

	// Get execution from context
	execution := reqCtx.Get(LoadedExecutionKey)
	if execution == nil {
		return nil, grpclib.InternalError(nil, "execution not found in context after pause pipeline")
	}

	log.Info().
		Str("execution_id", input.GetId()).
		Str("phase", execution.(*agentexecutionv1.AgentExecution).GetStatus().GetPhase().String()).
		Msg("Pause agent execution completed")

	return execution.(*agentexecutionv1.AgentExecution), nil
}

// buildPausePipeline constructs the pipeline for pause operations
func (c *AgentExecutionController) buildPausePipeline() *pipeline.Pipeline[*agentexecutionv1.PauseAgentExecutionInput] {
	return pipeline.NewPipeline[*agentexecutionv1.PauseAgentExecutionInput]("agentexecution-pause").
		AddStep(NewLoadExecutionByIdStep[*agentexecutionv1.PauseAgentExecutionInput](c.store)).
		AddStep(NewValidatePausableStep[*agentexecutionv1.PauseAgentExecutionInput]()).
		AddStep(NewSignalPauseToTemporalStep[*agentexecutionv1.PauseAgentExecutionInput](c.temporalClient)).
		AddStep(NewUpdateExecutionPhaseAndPersistStep[*agentexecutionv1.PauseAgentExecutionInput](
			c.store,
			agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED,
			false, // don't set error
			false, // don't clear error
		)).
		AddStep(NewLifecycleBroadcastStep[*agentexecutionv1.PauseAgentExecutionInput](c.streamBroker)).
		Build()
}

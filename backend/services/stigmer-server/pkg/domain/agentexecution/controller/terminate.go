package agentexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
)

// Terminate terminates an agent execution immediately.
//
// This RPC force-stops the agent execution via Temporal's TerminateWorkflow API without
// allowing cleanup. Unlike cancel, the agent cannot respond to termination -
// it is stopped immediately. Use this for stuck or unresponsive agents.
//
// Pipeline Steps:
// 1. LoadExecutionById - Load execution from database
// 2. ValidateTerminable - Check phase is PENDING or IN_PROGRESS (or already TERMINATED for idempotency)
// 3. TerminateTemporalWorkflow - Force-kill via Temporal
// 4. UpdateExecutionPhase - Set phase to TERMINATED, set completed_at, set error
// 5. PersistExecution - Save to database
// 6. BroadcastExecutionUpdate - Publish to StreamBroker for real-time subscribers
//
// Idempotency:
// If the execution is already terminated, the call succeeds as a no-op.
//
// Error Cases:
// - NOT_FOUND: Execution with given ID doesn't exist
// - FAILED_PRECONDITION: Execution is in a terminal phase (COMPLETED, FAILED, CANCELLED)
// - INVALID_ARGUMENT: ID is empty or malformed
func (c *AgentExecutionController) Terminate(
	ctx context.Context,
	input *agentexecutionv1.TerminateAgentExecutionInput,
) (*agentexecutionv1.AgentExecution, error) {
	log.Info().
		Str("execution_id", input.GetId()).
		Str("reason", input.GetReason()).
		Msg("Terminate agent execution request")

	// Create request context with the input
	reqCtx := pipeline.NewRequestContext(ctx, input)

	// Build and execute pipeline
	p := c.buildTerminatePipeline()
	if err := p.Execute(reqCtx); err != nil {
		log.Warn().
			Str("execution_id", input.GetId()).
			Err(err).
			Msg("Terminate agent execution failed")
		return nil, err
	}

	// Get execution from context
	execution := reqCtx.Get(LoadedExecutionKey)
	if execution == nil {
		return nil, grpclib.InternalError(nil, "execution not found in context after terminate pipeline")
	}

	log.Info().
		Str("execution_id", input.GetId()).
		Str("phase", execution.(*agentexecutionv1.AgentExecution).GetStatus().GetPhase().String()).
		Msg("Terminate agent execution completed")

	return execution.(*agentexecutionv1.AgentExecution), nil
}

// buildTerminatePipeline constructs the pipeline for terminate operations
func (c *AgentExecutionController) buildTerminatePipeline() *pipeline.Pipeline[*agentexecutionv1.TerminateAgentExecutionInput] {
	return pipeline.NewPipeline[*agentexecutionv1.TerminateAgentExecutionInput]("agentexecution-terminate").
		AddStep(NewLoadExecutionByIdStep[*agentexecutionv1.TerminateAgentExecutionInput](c.store)).
		AddStep(NewValidateTerminableStep[*agentexecutionv1.TerminateAgentExecutionInput]()).
		AddStep(NewTerminateTemporalWorkflowStep[*agentexecutionv1.TerminateAgentExecutionInput](c.temporalClient)).
		AddStep(NewUpdateExecutionPhaseAndPersistStep[*agentexecutionv1.TerminateAgentExecutionInput](
			c.store,
			agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED,
			true,  // set error with termination reason
			false, // don't clear error
		)).
		AddStep(NewLifecycleBroadcastStep[*agentexecutionv1.TerminateAgentExecutionInput](c.streamBroker)).
		Build()
}

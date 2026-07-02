package agentexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
)

// Resume resumes a paused agent execution.
//
// This RPC continues execution from the checkpoint where it was paused. The agent
// re-invokes with the same harness_state_id, loading from LangGraph checkpoint
// and continuing from where it left off.
//
// Pipeline Steps:
// 1. LoadExecutionById - Load execution from database
// 2. ValidateResumable - Check phase is PAUSED (or already IN_PROGRESS for idempotency)
// 3. SignalResumeToTemporal - Send resume signal to workflow
// 4. UpdateExecutionPhase - Set phase to IN_PROGRESS
// 5. PersistExecution - Save to database
// 6. BroadcastExecutionUpdate - Publish to StreamBroker for real-time subscribers
//
// Idempotency:
// If the execution is already running (IN_PROGRESS), the call succeeds as a no-op.
//
// Error Cases:
// - NOT_FOUND: Execution with given ID doesn't exist
// - FAILED_PRECONDITION: Execution is not in PAUSED phase
// - INVALID_ARGUMENT: ID is empty or malformed
func (c *AgentExecutionController) Resume(
	ctx context.Context,
	input *agentexecutionv1.ResumeAgentExecutionInput,
) (*agentexecutionv1.AgentExecution, error) {
	log.Info().
		Str("execution_id", input.GetId()).
		Msg("Resume agent execution request")

	// Create request context with the input
	reqCtx := pipeline.NewRequestContext(ctx, input)

	// Build and execute pipeline
	p := c.buildResumePipeline()
	if err := p.Execute(reqCtx); err != nil {
		log.Warn().
			Str("execution_id", input.GetId()).
			Err(err).
			Msg("Resume agent execution failed")
		return nil, err
	}

	// Get execution from context
	execution := reqCtx.Get(LoadedExecutionKey)
	if execution == nil {
		return nil, grpclib.InternalError(nil, "execution not found in context after resume pipeline")
	}

	log.Info().
		Str("execution_id", input.GetId()).
		Str("phase", execution.(*agentexecutionv1.AgentExecution).GetStatus().GetPhase().String()).
		Msg("Resume agent execution completed")

	return execution.(*agentexecutionv1.AgentExecution), nil
}

// buildResumePipeline constructs the pipeline for resume operations
func (c *AgentExecutionController) buildResumePipeline() *pipeline.Pipeline[*agentexecutionv1.ResumeAgentExecutionInput] {
	return pipeline.NewPipeline[*agentexecutionv1.ResumeAgentExecutionInput]("agentexecution-resume").
		AddStep(NewLoadExecutionByIdStep[*agentexecutionv1.ResumeAgentExecutionInput](c.store)).
		AddStep(NewValidateResumableStep[*agentexecutionv1.ResumeAgentExecutionInput]()).
		AddStep(NewSignalResumeToTemporalStep[*agentexecutionv1.ResumeAgentExecutionInput](c.temporalClient)).
		AddStep(NewUpdateExecutionPhaseAndPersistStep[*agentexecutionv1.ResumeAgentExecutionInput](
			c.store,
			agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			false, // don't set error
			false, // don't clear error
		)).
		AddStep(NewLifecycleBroadcastStep[*agentexecutionv1.ResumeAgentExecutionInput](c.streamBroker)).
		Build()
}

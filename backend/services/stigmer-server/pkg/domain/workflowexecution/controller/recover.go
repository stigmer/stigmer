package workflowexecution

import (
	"context"

	"github.com/rs/zerolog/log"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
)

// Recover recovers a failed workflow execution by terminating the existing
// (possibly stuck) Temporal orchestrator and starting a fresh one with
// recovery_mode enabled.
//
// The workflow engine reads the previous run's completed task outputs from
// status.tasks[], skips tasks that already completed, and resumes execution
// from the first incomplete or failed task. Environment variables are
// re-resolved from the current WorkflowInstance and Workflow configuration,
// which is desirable for "fix the config, then recover" scenarios.
//
// Known limitation: runtime_env overrides provided at original execution time
// are not preserved — they were stripped before persist.
//
// Pipeline Steps:
//  1. LoadExecutionById - Load execution from database
//  2. ValidateRecoverable - Check phase is FAILED (not TERMINATED/CANCELLED)
//  3. TerminateExistingWorkflow - Terminate stuck/running Temporal workflow
//  4. RecreateExecutionContext - Re-resolve env, create fresh EC
//  5. StartFreshWorkflow - Start new Temporal orchestrator via WorkflowCreator
//  6. UpdateExecutionPhase - Set phase to IN_PROGRESS, clear error/completed_at
//  7. PersistExecution - Save to database
//  8. BroadcastExecutionUpdate - Publish to StreamBroker for real-time subscribers
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

	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildRecoverPipeline()
	if err := p.Execute(reqCtx); err != nil {
		log.Warn().
			Str("execution_id", input.GetId()).
			Err(err).
			Msg("Recover workflow execution failed")
		return nil, err
	}

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

// buildRecoverPipeline constructs the pipeline for recover operations.
//
// Pipeline order rationale:
//   - Terminate BEFORE EC recreation (prevents old workflow's cleanup from deleting new EC)
//   - Recreate EC BEFORE workflow start (hydration needs env)
//   - Start workflow BEFORE phase update (if start fails, execution stays FAILED — user can retry)
func (c *WorkflowExecutionController) buildRecoverPipeline() *pipeline.Pipeline[*workflowexecutionv1.RecoverWorkflowExecutionInput] {
	return pipeline.NewPipeline[*workflowexecutionv1.RecoverWorkflowExecutionInput]("workflowexecution-recover").
		AddStep(NewLoadExecutionByIdStep[*workflowexecutionv1.RecoverWorkflowExecutionInput](c.store)).
		AddStep(NewValidateRecoverableStep[*workflowexecutionv1.RecoverWorkflowExecutionInput]()).
		AddStep(NewTerminateExistingWorkflowStep[*workflowexecutionv1.RecoverWorkflowExecutionInput](c.temporalClient)).
		AddStep(newRecreateExecutionContextStep(
			c.store, c.workflowInstanceClient, c.environmentClient, c.executionContextClient,
		)).
		AddStep(NewStartFreshWorkflowStep[*workflowexecutionv1.RecoverWorkflowExecutionInput](
			c.workflowCreator, c.temporalConfig,
		)).
		AddStep(NewUpdateExecutionPhaseStep[*workflowexecutionv1.RecoverWorkflowExecutionInput](
			workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			false, // don't set error
			true,  // clear error (recovering from failure)
		)).
		AddStep(NewLifecyclePersistStep[*workflowexecutionv1.RecoverWorkflowExecutionInput](c.store)).
		AddStep(NewLifecycleBroadcastStep[*workflowexecutionv1.RecoverWorkflowExecutionInput](c.streamBroker)).
		Build()
}

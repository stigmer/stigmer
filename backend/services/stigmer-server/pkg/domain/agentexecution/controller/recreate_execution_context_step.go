package agentexecution

import (
	"fmt"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// recreateExecutionContextStep rebuilds the ExecutionContext for a recovered
// execution.
//
// The failed run's workflow cleanup deleted the EC (it holds the fully-merged
// environment, including secrets), so a fresh start would otherwise hydrate
// with an empty environment. The environment is re-resolved from the CURRENT
// agent/instance/environment configuration via the shared
// executionContextBuilder — desirable for "fix the API key, then recover".
// runtime_env overrides from the original create are not recoverable (they
// were consumed into the original EC and cleared before persist), the same
// known limitation WorkflowExecution recovery has.
//
// Deliberate divergence from WorkflowExecution's recreate step (which degrades
// gracefully on resolution failures): a failure here FAILS the recover RPC.
// The agent EC carries OAuth tokens and declared env vars the run genuinely
// needs, and proceeding without them trades an actionable error now for an
// opaque downstream failure mid-run. The execution stays FAILED, so recover
// can simply be retried once the cause is fixed.
type recreateExecutionContextStep struct {
	store   store.Store
	builder *executionContextBuilder
}

func (c *AgentExecutionController) newRecreateExecutionContextStep() *recreateExecutionContextStep {
	return &recreateExecutionContextStep{
		store:   c.store,
		builder: c.newExecutionContextBuilder(),
	}
}

func (s *recreateExecutionContextStep) Name() string {
	return "RecreateExecutionContext"
}

func (s *recreateExecutionContextStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.RecoverAgentExecutionInput]) error {
	if ctx.Get("alreadyInTargetState") == true {
		return nil
	}

	execution := ctx.Get(LoadedExecutionKey).(*agentexecutionv1.AgentExecution)
	executionID := execution.GetMetadata().GetId()

	log.Debug().
		Str("execution_id", executionID).
		Msg("Recreating ExecutionContext for recovered execution")

	// Delete any stale EC first (best-effort): the failure-path cleanup is
	// itself best-effort, so a leftover EC may still exist and would collide
	// with the recreate (the EC name is derived from the execution ID).
	s.deleteStaleEC(ctx, executionID)

	// No pre-resolved instance id on the recover path: a persisted execution
	// always carries session_id (the create pipeline guarantees it), so the
	// builder resolves the instance via the session.
	if err := s.builder.buildAndPersist(ctx.Context(), execution, ""); err != nil {
		return fmt.Errorf("recreate execution context for recovered execution %s: %w", executionID, err)
	}

	return nil
}

// deleteStaleEC removes any existing ExecutionContext for this execution (best-effort).
func (s *recreateExecutionContextStep) deleteStaleEC(
	ctx *pipeline.RequestContext[*agentexecutionv1.RecoverAgentExecutionInput],
	executionID string,
) {
	existing := &executioncontextv1.ExecutionContext{}
	err := s.store.FindByField(ctx.Context(),
		apiresourcekind.ApiResourceKind_execution_context,
		"spec.executionId", executionID, existing)
	if err != nil {
		return
	}

	ecID := existing.GetMetadata().GetId()
	if ecID == "" {
		return
	}

	log.Info().
		Str("execution_context_id", ecID).
		Str("execution_id", executionID).
		Msg("Deleting stale ExecutionContext before recreation")

	if deleteErr := s.store.DeleteResource(ctx.Context(),
		apiresourcekind.ApiResourceKind_execution_context, ecID); deleteErr != nil {
		log.Warn().
			Str("execution_context_id", ecID).
			Err(deleteErr).
			Msg("Failed to delete stale ExecutionContext (proceeding anyway)")
	}
}

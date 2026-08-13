package activities

import (
	"context"
	"errors"

	"github.com/rs/zerolog/log"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// DeleteExecutionContextActivityImpl deletes the ExecutionContext associated with
// a completed execution (agent or workflow).
//
// The ExecutionContext is an ephemeral resource containing the fully-merged
// environment (environment_refs values overridden by runtime_env, filtered to
// the blueprint's declared env keys), including secrets. It must be cleaned up
// when the execution finishes to prevent sensitive data from persisting
// beyond the execution lifetime.
//
// This is a local activity (runs in-process on the workflow worker) shared by
// both AgentExecution and WorkflowExecution workflows.
//
// Behavior:
//   - Idempotent: no-op if the ExecutionContext does not exist
//   - Best-effort: logs errors but never returns them -- cleanup failure must
//     not affect the workflow outcome. A TTL-based backup index provides
//     defense-in-depth for orphaned contexts.
//   - Security-aware: logs variable count, never variable names or values
type DeleteExecutionContextActivityImpl struct {
	store store.Store
}

// NewDeleteExecutionContextActivityImpl creates a new activity implementation.
func NewDeleteExecutionContextActivityImpl(store store.Store) *DeleteExecutionContextActivityImpl {
	return &DeleteExecutionContextActivityImpl{store: store}
}

// DeleteExecutionContext finds and deletes the ExecutionContext for the given
// execution ID. The execution ID may be either an AgentExecution or
// WorkflowExecution ID -- the lookup uses the spec.executionId field.
func (a *DeleteExecutionContextActivityImpl) DeleteExecutionContext(ctx context.Context, executionID string) error {
	log.Debug().
		Str("execution_id", executionID).
		Msg("Cleaning up ExecutionContext for execution")

	ec := &executioncontextv1.ExecutionContext{}

	if err := a.store.FindByField(
		ctx,
		apiresourcekind.ApiResourceKind_execution_context,
		"spec.executionId",
		executionID,
		ec,
	); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			log.Debug().
				Str("execution_id", executionID).
				Msg("No ExecutionContext found for execution -- nothing to clean up")
			return nil
		}
		log.Warn().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to query ExecutionContext -- will rely on TTL cleanup")
		return nil
	}

	contextID := ec.GetMetadata().GetId()
	dataCount := len(ec.GetSpec().GetData())

	if err := a.store.DeleteResource(
		ctx,
		apiresourcekind.ApiResourceKind_execution_context,
		contextID,
	); err != nil {
		log.Warn().
			Err(err).
			Str("execution_id", executionID).
			Str("context_id", contextID).
			Msg("Failed to delete ExecutionContext -- will rely on TTL cleanup")
		return nil
	}

	log.Info().
		Str("execution_id", executionID).
		Str("context_id", contextID).
		Int("variables", dataCount).
		Msg("Deleted ExecutionContext for execution")

	return nil
}

// DeleteExecutionContextActivityName is the activity name for registration.
const DeleteExecutionContextActivityName = "DeleteExecutionContext"

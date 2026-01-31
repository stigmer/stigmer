package executioncontext

import (
	"context"
	"errors"

	"github.com/rs/zerolog/log"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// GetByExecutionId retrieves an execution context by the execution ID it belongs to.
//
// This is the primary lookup method used by runners (workflow-runner, agent-runner)
// to retrieve the merged environment variables during execution. The execution_id
// corresponds to either a WorkflowExecution ID or AgentExecution ID.
//
// Use cases:
//   - Go workflow-runner queries for merged env vars before executing workflow
//   - Python agent-runner queries for merged env vars before executing agent
//
// Pipeline steps:
//  1. ValidateProto - Validate input ExecutionContextExecutionIdInput
//  2. LoadByExecutionId - Query store by spec.execution_id field
//
// Note: In OSS, secrets are not encrypted (no encryption key configured).
// In Cloud, this RPC returns decrypted secrets for runner consumption.
//
// Authorization: This is an operator-only action (platform-scoped).
// OSS does not enforce authorization, but the proto defines operator permission.
func (c *ExecutionContextController) GetByExecutionId(ctx context.Context, input *executioncontextv1.ExecutionContextExecutionIdInput) (*executioncontextv1.ExecutionContext, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	p := c.buildGetByExecutionIdPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded execution context from context
	executionContext := reqCtx.Get(steps.TargetResourceKey).(*executioncontextv1.ExecutionContext)
	return executionContext, nil
}

// buildGetByExecutionIdPipeline constructs the pipeline for get-by-execution-id operations.
func (c *ExecutionContextController) buildGetByExecutionIdPipeline() *pipeline.Pipeline[*executioncontextv1.ExecutionContextExecutionIdInput] {
	return pipeline.NewPipeline[*executioncontextv1.ExecutionContextExecutionIdInput]("execution-context-get-by-execution-id").
		AddStep(steps.NewValidateProtoStep[*executioncontextv1.ExecutionContextExecutionIdInput]()). // 1. Validate input
		AddStep(newLoadByExecutionIdStep(c.store)).                                                  // 2. Load by execution_id
		Build()
}

// =============================================================================
// Pipeline Steps
// =============================================================================

// loadByExecutionIdStep loads an ExecutionContext by querying spec.execution_id field.
//
// Unlike the standard LoadTarget step which queries by resource ID, this step
// queries by a field within the proto message (spec.execution_id).
//
// The step:
//  1. Extracts execution_id from input
//  2. Queries store with field filter: spec.executionId = execution_id
//  3. Stores the loaded resource in context with key "targetResource"
//  4. Returns NotFound error if no matching context exists
type loadByExecutionIdStep struct {
	store store.Store
}

func newLoadByExecutionIdStep(s store.Store) *loadByExecutionIdStep {
	return &loadByExecutionIdStep{store: s}
}

func (s *loadByExecutionIdStep) Name() string {
	return "LoadByExecutionId"
}

func (s *loadByExecutionIdStep) Execute(ctx *pipeline.RequestContext[*executioncontextv1.ExecutionContextExecutionIdInput]) error {
	input := ctx.Input()

	executionId := input.GetExecutionId()
	if executionId == "" {
		return grpclib.InvalidArgumentError("execution_id is required")
	}

	log.Debug().
		Str("execution_id", executionId).
		Msg("Loading ExecutionContext by execution_id")

	// Create a new ExecutionContext instance for the query
	executionContext := &executioncontextv1.ExecutionContext{}

	// Use the store's FindByField method to query by spec.executionId
	// The field path is "spec.executionId" (protobuf JSON field naming)
	err := s.store.FindByField(
		ctx.Context(),
		executioncontextv1.ExecutionContext_Api_resource_kind,
		"spec.executionId",
		executionId,
		executionContext,
	)

	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			log.Debug().
				Str("execution_id", executionId).
				Msg("ExecutionContext not found for execution_id")
			return grpclib.NotFoundError("execution_context", "execution_id="+executionId)
		}
		log.Error().
			Err(err).
			Str("execution_id", executionId).
			Msg("Failed to query ExecutionContext by execution_id")
		return grpclib.InternalError("failed to query execution context: %v", err)
	}

	log.Debug().
		Str("execution_id", executionId).
		Str("context_id", executionContext.GetMetadata().GetId()).
		Msg("Successfully loaded ExecutionContext by execution_id")

	// Store loaded resource in context for handler to return
	ctx.Set(steps.TargetResourceKey, executionContext)

	return nil
}

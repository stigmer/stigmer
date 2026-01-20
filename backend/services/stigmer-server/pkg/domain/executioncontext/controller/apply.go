package executioncontext

import (
	"context"

	"github.com/rs/zerolog/log"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Apply creates or updates an execution context based on whether it already exists
//
// This implements declarative "apply" semantics (similar to kubectl apply):
// - Checks if resource exists by slug
// - If exists → returns error (ExecutionContext doesn't have update handler)
// - If not exists → delegates to Create()
//
// Note: ExecutionContext is a create-only resource. Apply will only create new contexts.
// If a context with the same slug exists, an error is returned.
//
// Pipeline (minimal - just for existence check):
// 1. ValidateProto - Validate field constraints
// 2. ResolveSlug - Generate slug from metadata.name
// 3. LoadForApply - Attempt to load existing (doesn't fail if not found)
// 4. Delegate decision based on context flags
//
// The heavy lifting (validation, persistence, etc.) is handled by
// the delegated Create handler.
func (c *ExecutionContextController) Apply(ctx context.Context, executionContext *executioncontextv1.ExecutionContext) (*executioncontextv1.ExecutionContext, error) {
	reqCtx := pipeline.NewRequestContext(ctx, executionContext)

	// Build and execute minimal apply pipeline
	p := c.buildApplyPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Check shouldCreate flag set by LoadForApplyStep
	shouldCreateVal := reqCtx.Get(steps.ShouldCreateKey)
	if shouldCreateVal == nil {
		log.Error().Msg("Apply pipeline did not set shouldCreate flag")
		return nil, grpclib.InternalError(nil, "apply operation failed to determine create vs update")
	}

	shouldCreate := shouldCreateVal.(bool)

	// Delegate to appropriate handler
	if shouldCreate {
		log.Info().
			Str("slug", executionContext.GetMetadata().GetName()).
			Msg("ExecutionContext does not exist - delegating to CREATE")
		return c.Create(ctx, executionContext)
	}

	// ExecutionContext doesn't support update - return error
	log.Warn().
		Str("slug", executionContext.GetMetadata().GetName()).
		Str("id", executionContext.GetMetadata().GetId()).
		Msg("ExecutionContext already exists - UPDATE not supported")
	return nil, grpclib.AlreadyExistsError("ExecutionContext", executionContext.GetMetadata().GetName())
}

// buildApplyPipeline constructs the minimal pipeline for apply operations
//
// This pipeline only determines whether to create or fail.
// It does NOT perform the actual create - that's delegated.
func (c *ExecutionContextController) buildApplyPipeline() *pipeline.Pipeline[*executioncontextv1.ExecutionContext] {
	return pipeline.NewPipeline[*executioncontextv1.ExecutionContext]("execution-context-apply").
		AddStep(steps.NewValidateProtoStep[*executioncontextv1.ExecutionContext]()).       // 1. Validate input
		AddStep(steps.NewResolveSlugStep[*executioncontextv1.ExecutionContext]()).         // 2. Resolve slug
		AddStep(steps.NewLoadForApplyStep[*executioncontextv1.ExecutionContext](c.store)). // 3. Check existence
		Build()
}

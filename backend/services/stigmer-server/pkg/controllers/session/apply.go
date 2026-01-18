package session

import (
	"context"

	"github.com/rs/zerolog/log"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	sessionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/session/v1"
)

// Apply creates or updates a session based on whether it already exists
//
// This implements declarative "apply" semantics (similar to kubectl apply):
// - Checks if resource exists by slug
// - If exists → delegates to Update()
// - If not exists → delegates to Create()
//
// Pipeline (minimal - just for existence check):
// 1. ValidateProto - Validate field constraints
// 2. ResolveSlug - Generate slug from metadata.name
// 3. LoadForApply - Attempt to load existing (doesn't fail if not found)
// 4. Delegate decision based on context flags
//
// The heavy lifting (validation, persistence, etc.) is handled by
// the delegated Create or Update handlers.
func (c *SessionController) Apply(ctx context.Context, session *sessionv1.Session) (*sessionv1.Session, error) {
	reqCtx := pipeline.NewRequestContext(ctx, session)

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
			Str("slug", session.GetMetadata().GetName()).
			Msg("Resource does not exist - delegating to CREATE")
		return c.Create(ctx, session)
	}

	log.Info().
		Str("slug", session.GetMetadata().GetName()).
		Str("id", session.GetMetadata().GetId()).
		Msg("Resource exists - delegating to UPDATE")
	return c.Update(ctx, session)
}

// buildApplyPipeline constructs the minimal pipeline for apply operations
//
// This pipeline only determines whether to create or update.
// It does NOT perform the actual create/update - that's delegated.
func (c *SessionController) buildApplyPipeline() *pipeline.Pipeline[*sessionv1.Session] {
	return pipeline.NewPipeline[*sessionv1.Session]("session-apply").
		AddStep(steps.NewValidateProtoStep[*sessionv1.Session]()).       // 1. Validate input
		AddStep(steps.NewResolveSlugStep[*sessionv1.Session]()).         // 2. Resolve slug
		AddStep(steps.NewLoadForApplyStep[*sessionv1.Session](c.store)). // 3. Check existence
		Build()
}

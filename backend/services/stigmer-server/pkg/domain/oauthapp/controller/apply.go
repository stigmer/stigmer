package oauthapp

import (
	"context"

	"github.com/rs/zerolog/log"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Apply creates or updates an OAuthApp based on whether it already exists.
//
// This implements declarative "apply" semantics (similar to kubectl apply):
//   - Checks if resource exists by slug
//   - If exists -> delegates to Update()
//   - If not exists -> delegates to Create()
//
// Pipeline (minimal - just for existence check):
//  1. ValidateProto - Validate field constraints
//  2. ResolveSlug - Generate slug from metadata.name
//  3. LoadForApply - Attempt to load existing (doesn't fail if not found)
//  4. Delegate decision based on context flags
//
// Apply is the recommended method for CLI usage as it provides idempotent
// behavior - the same configuration can be applied multiple times with
// consistent results.
func (c *OAuthAppController) Apply(ctx context.Context, app *oauthappv1.OAuthApp) (*oauthappv1.OAuthApp, error) {
	reqCtx := pipeline.NewRequestContext(ctx, app)

	p := c.buildApplyPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	shouldCreateVal := reqCtx.Get(steps.ShouldCreateKey)
	if shouldCreateVal == nil {
		log.Error().Msg("Apply pipeline did not set shouldCreate flag")
		return nil, grpclib.InternalError(nil, "apply operation failed to determine create vs update")
	}

	shouldCreate := shouldCreateVal.(bool)

	if shouldCreate {
		log.Info().
			Str("slug", app.GetMetadata().GetName()).
			Msg("OAuthApp does not exist - delegating to CREATE")
		return c.Create(ctx, app)
	}

	log.Info().
		Str("slug", app.GetMetadata().GetName()).
		Str("id", app.GetMetadata().GetId()).
		Msg("OAuthApp exists - delegating to UPDATE")
	return c.Update(ctx, app)
}

// buildApplyPipeline constructs the minimal pipeline for apply operations.
//
// This pipeline only determines whether to create or update.
// It does NOT perform the actual create/update - that's delegated.
func (c *OAuthAppController) buildApplyPipeline() *pipeline.Pipeline[*oauthappv1.OAuthApp] {
	return pipeline.NewPipeline[*oauthappv1.OAuthApp]("oauthapp-apply").
		AddStep(steps.NewValidateProtoStep[*oauthappv1.OAuthApp]()).       // 1. Validate input
		AddStep(steps.NewResolveSlugStep[*oauthappv1.OAuthApp]()).         // 2. Resolve slug
		AddStep(steps.NewLoadForApplyStep[*oauthappv1.OAuthApp](c.store)). // 3. Check existence
		Build()
}

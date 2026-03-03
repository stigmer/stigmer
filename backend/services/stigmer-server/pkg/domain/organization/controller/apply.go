package organization

import (
	"context"

	"github.com/rs/zerolog/log"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Apply creates or updates an organization based on whether it already exists.
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
func (c *OrganizationController) Apply(ctx context.Context, org *organizationv1.Organization) (*organizationv1.Organization, error) {
	reqCtx := pipeline.NewRequestContext(ctx, org)

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
			Str("slug", org.GetMetadata().GetName()).
			Msg("Resource does not exist - delegating to CREATE")
		return c.Create(ctx, org)
	}

	log.Info().
		Str("slug", org.GetMetadata().GetName()).
		Str("id", org.GetMetadata().GetId()).
		Msg("Resource exists - delegating to UPDATE")
	return c.Update(ctx, org)
}

// buildApplyPipeline constructs the minimal pipeline for apply operations.
//
// This pipeline only determines whether to create or update.
// It does NOT perform the actual create/update - that's delegated.
func (c *OrganizationController) buildApplyPipeline() *pipeline.Pipeline[*organizationv1.Organization] {
	return pipeline.NewPipeline[*organizationv1.Organization]("organization-apply").
		AddStep(steps.NewValidateProtoStep[*organizationv1.Organization]()).       // 1. Validate input
		AddStep(steps.NewResolveSlugStep[*organizationv1.Organization]()).         // 2. Resolve slug
		AddStep(steps.NewLoadForApplyStep[*organizationv1.Organization](c.store)). // 3. Check existence
		Build()
}

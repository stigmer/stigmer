package organization

import (
	"context"

	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// Update updates an existing Organization resource using the pipeline framework.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (buf.validate)
//  2. ResolveSlug - Generate slug from metadata.name
//  3. LoadExisting - Load existing organization from repository by ID
//  4. BuildUpdateState - Merge spec, preserve IDs, update timestamps
//  5. Persist - Save updated organization to repository
//  6. IndexSearch - Update FTS5 search index
//
// Note: Compared to Stigmer Cloud, OSS excludes:
//   - Authorize step (no multi-tenant auth in OSS)
//   - Publish step (no event publishing in OSS)
//   - Immutability enforcement for management_mode (deferred)
func (c *OrganizationController) Update(ctx context.Context, org *organizationv1.Organization) (*organizationv1.Organization, error) {
	reqCtx := pipeline.NewRequestContext(ctx, org)

	p := c.buildUpdatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildUpdatePipeline constructs the pipeline for organization update.
//
// The api_resource_kind is automatically extracted from proto service descriptor
// by the apiresource interceptor and injected into request context.
func (c *OrganizationController) buildUpdatePipeline() *pipeline.Pipeline[*organizationv1.Organization] {
	return pipeline.NewPipeline[*organizationv1.Organization]("organization-update").
		AddStep(steps.NewValidateProtoStep[*organizationv1.Organization]()).                                            // 1. Validate field constraints
		AddStep(steps.NewResolveSlugStep[*organizationv1.Organization]()).                                              // 2. Resolve slug
		AddStep(steps.NewLoadExistingStep[*organizationv1.Organization](c.store)).                                      // 3. Load existing organization
		AddStep(steps.NewBuildUpdateStateStep[*organizationv1.Organization]()).                                         // 4. Build updated state
		AddStep(steps.NewPersistStep[*organizationv1.Organization](c.store)).                                           // 5. Persist organization
		AddStep(steps.NewIndexSearchStep[*organizationv1.Organization](c.store, &extractor.OrganizationExtractor{})). // 6. Update search index
		Build()
}

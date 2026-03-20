package organization

import (
	"context"

	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/search/extractor"
)

// Create creates a new Organization resource using the pipeline framework.
//
// Pipeline Steps:
//  1. ResolveSlug - Generate slug from metadata.name (if not already set)
//  2. ValidateProto - Validate proto field constraints (buf.validate)
//     - api_version must be "tenancy.stigmer.ai/v1"
//     - kind must be "Organization"
//     - metadata.slug must match pattern, length 2-15 chars
//  3. CheckDuplicate - Verify no duplicate exists by slug (global uniqueness)
//  4. BuildNewState - Generate ID (org-{ulid}), clear status, set audit fields
//  5. Persist - Save organization to repository
//  6. IndexSearch - Update FTS5 search index
//
// Note: Compared to Stigmer Cloud, OSS excludes:
//   - Authorize step (no multi-tenant auth in OSS)
//   - CreateIamPolicies step (no IAM/FGA in OSS)
//   - Publish step (no event publishing in OSS)
func (c *OrganizationController) Create(ctx context.Context, org *organizationv1.Organization) (*organizationv1.Organization, error) {
	reqCtx := pipeline.NewRequestContext(ctx, org)

	p := c.buildCreatePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// buildCreatePipeline constructs the pipeline for organization creation.
//
// ResolveSlug runs before ValidateProto so that clients can omit the slug
// and have it derived from metadata.name before field constraints are checked.
//
// The api_resource_kind is automatically extracted from proto service descriptor
// by the apiresource interceptor and injected into request context.
func (c *OrganizationController) buildCreatePipeline() *pipeline.Pipeline[*organizationv1.Organization] {
	return pipeline.NewPipeline[*organizationv1.Organization]("organization-create").
		AddStep(steps.NewResolveSlugStep[*organizationv1.Organization]()).                                            // 1. Resolve slug
		AddStep(steps.NewValidateProtoStep[*organizationv1.Organization]()).                                          // 2. Validate field constraints
		AddStep(steps.NewCheckDuplicateStep[*organizationv1.Organization](c.store)).                                  // 3. Check duplicate
		AddStep(steps.NewBuildNewStateStep[*organizationv1.Organization]()).                                          // 4. Build new state
		AddStep(steps.NewPersistStep[*organizationv1.Organization](c.store)).                                         // 5. Persist organization
		AddStep(steps.NewIndexSearchStep[*organizationv1.Organization](c.store, &extractor.OrganizationExtractor{})). // 6. Update search index
		Build()
}

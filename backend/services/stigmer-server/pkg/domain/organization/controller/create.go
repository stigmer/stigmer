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
//  3. CheckDuplicate - Reject a duplicate slug, checked GLOBALLY by id
//     (organizations use slug as id; see step 5). Mirrors cloud's
//     OrganizationCreateHandler.CheckDuplicate.
//  4. BuildNewState - Mint a throwaway org_<ulid>, clear status, set audit fields
//  5. CopySlugToId - Overwrite the id with the slug (the id == slug exception),
//     mirroring cloud's OrganizationCreateHandler.CopySlugToId
//  6. Persist - Save organization to repository
//  7. IndexSearch - Update FTS5 search index
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
// The duplicate check and CopySlugToId are organization-specific (org is the
// sole resource whose id equals its slug); they mirror cloud's
// OrganizationCreateHandler step-for-step. See steps.go for the rationale.
//
// The api_resource_kind is automatically extracted from proto service descriptor
// by the apiresource interceptor and injected into request context.
func (c *OrganizationController) buildCreatePipeline() *pipeline.Pipeline[*organizationv1.Organization] {
	return pipeline.NewPipeline[*organizationv1.Organization]("organization-create").
		AddStep(steps.NewResolveSlugStep[*organizationv1.Organization]()).                                            // 1. Resolve slug
		AddStep(steps.NewValidateProtoStep[*organizationv1.Organization]()).                                          // 2. Validate field constraints
		AddStep(newCheckOrgDuplicateStep(c.store)).                                                                   // 3. Check duplicate (global, by id)
		AddStep(steps.NewBuildNewStateStep[*organizationv1.Organization]()).                                          // 4. Build new state (mints org_<ulid>)
		AddStep(newCopySlugToIdStep()).                                                                               // 5. id == slug (override)
		AddStep(steps.NewPersistStep[*organizationv1.Organization](c.store)).                                         // 6. Persist organization
		AddStep(steps.NewIndexSearchStep[*organizationv1.Organization](c.store, &extractor.OrganizationExtractor{})). // 7. Update search index
		Build()
}

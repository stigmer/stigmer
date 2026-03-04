package organization

import (
	"context"

	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Delete deletes an organization by ID using the pipeline pattern.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (OrganizationId)
//  2. ExtractResourceId - Extract ID from OrganizationId.Value wrapper
//  3. LoadExistingForDelete - Load organization from database (stores in context)
//  4. DeleteResource - Delete organization from database
//  5. DeleteSearchIndex - Remove from FTS5 search index
//
// Note: Unlike Stigmer Cloud, OSS excludes:
//   - Authorization step (no multi-user auth)
//   - IAM policy cleanup (no IAM system)
//   - Event publishing (no event system)
//   - Cascade delete of child resources (future consideration)
//
// The deleted organization is returned for audit trail purposes (gRPC convention).
func (c *OrganizationController) Delete(ctx context.Context, orgId *organizationv1.OrganizationId) (*organizationv1.Organization, error) {
	reqCtx := pipeline.NewRequestContext(ctx, orgId)

	p := c.buildDeletePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	deletedOrg := reqCtx.Get(steps.ExistingResourceKey)
	if deletedOrg == nil {
		return nil, grpclib.InternalError(nil, "deleted organization not found in context")
	}

	return deletedOrg.(*organizationv1.Organization), nil
}

// buildDeletePipeline constructs the pipeline for delete operations.
//
// Uses ExtractResourceIdStep because OrganizationId has GetValue() (same
// pattern as ProjectId), unlike ApiResourceDeleteInput which requires
// manual ID extraction.
//
// The api_resource_kind is automatically extracted from proto service descriptor
// by the apiresource interceptor and injected into request context.
func (c *OrganizationController) buildDeletePipeline() *pipeline.Pipeline[*organizationv1.OrganizationId] {
	return pipeline.NewPipeline[*organizationv1.OrganizationId]("organization-delete").
		AddStep(steps.NewValidateProtoStep[*organizationv1.OrganizationId]()).                                              // 1. Validate field constraints
		AddStep(steps.NewExtractResourceIdStep[*organizationv1.OrganizationId]()).                                          // 2. Extract ID from wrapper
		AddStep(steps.NewLoadExistingForDeleteStep[*organizationv1.OrganizationId, *organizationv1.Organization](c.store)). // 3. Load organization
		AddStep(steps.NewDeleteResourceStep[*organizationv1.OrganizationId](c.store)).                                      // 4. Delete from database
		AddStep(steps.NewDeleteSearchIndexStep[*organizationv1.OrganizationId](c.store)).                                   // 5. Remove from search index
		Build()
}

package organization

import (
	"context"

	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Get retrieves an organization by ID using the pipeline framework.
//
// Pipeline Steps:
//  1. ValidateProto - Validate input OrganizationId (ensures value is not empty)
//  2. LoadTarget - Load organization from repository by ID, returns NotFound if missing
//
// Note: Compared to Stigmer Cloud, OSS excludes:
//   - Authorize step (no multi-tenant auth in OSS)
//   - TransformResponse step (no response transformations in OSS)
//
// The loaded organization is stored in context with key "targetResource" and
// returned by the handler.
func (c *OrganizationController) Get(ctx context.Context, orgId *organizationv1.OrganizationId) (*organizationv1.Organization, error) {
	reqCtx := pipeline.NewRequestContext(ctx, orgId)

	p := c.buildGetPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	org := reqCtx.Get(steps.TargetResourceKey).(*organizationv1.Organization)
	return org, nil
}

// buildGetPipeline constructs the pipeline for get-by-id operations.
//
// The api_resource_kind is automatically extracted from proto service descriptor
// by the apiresource interceptor and injected into request context.
func (c *OrganizationController) buildGetPipeline() *pipeline.Pipeline[*organizationv1.OrganizationId] {
	return pipeline.NewPipeline[*organizationv1.OrganizationId]("organization-get").
		AddStep(steps.NewValidateProtoStep[*organizationv1.OrganizationId]()).                                   // 1. Validate input
		AddStep(steps.NewLoadTargetStep[*organizationv1.OrganizationId, *organizationv1.Organization](c.store)). // 2. Load by ID
		Build()
}

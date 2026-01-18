package environment

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	environmentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
)

// GetByReference retrieves an environment by ApiResourceReference (slug-based lookup) using the pipeline framework
//
// This implements the GetByReference operation pattern:
// 1. ValidateProto - Validate input ApiResourceReference
// 2. LoadByReference - Load environment by slug (with optional org filtering)
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// - ValidateProto: Validates buf.validate constraints on ApiResourceReference
// - LoadByReference: Queries environments by slug, handles org-scoped and identity-scoped lookups
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - TransformResponse step (no response transformations in OSS)
// - SendResponse step (handler returns directly)
//
// Reference Lookup Logic:
// - If ref.org is provided: queries environments in that org with matching slug
// - If ref.org is empty: queries identity-scoped environments with matching slug
// - Slug is matched against metadata.name (slug is normalized name)
//
// The loaded environment is stored in context with key "targetResource" and
// returned by the handler.
func (c *EnvironmentController) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*environmentv1.Environment, error) {
	reqCtx := pipeline.NewRequestContext(ctx, ref)

	p := c.buildGetByReferencePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded environment from context
	environment := reqCtx.Get(steps.TargetResourceKey).(*environmentv1.Environment)
	return environment, nil
}

// buildGetByReferencePipeline constructs the pipeline for get-by-reference operations
//
// This pipeline is generic and reusable across all resources.
// It uses standard steps from the pipeline/steps package.
func (c *EnvironmentController) buildGetByReferencePipeline() *pipeline.Pipeline[*apiresource.ApiResourceReference] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*apiresource.ApiResourceReference]("environment-get-by-reference").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceReference]()).       // 1. Validate input
		AddStep(steps.NewLoadByReferenceStep[*environmentv1.Environment](c.store)). // 2. Load by slug
		Build()
}

package agentinstance

import (
	"context"

	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

// GetByReference retrieves an agent instance by ApiResourceReference (slug-based lookup) using the pipeline framework
//
// This implements the GetByReference operation pattern:
// 1. ValidateProto - Validate input ApiResourceReference
// 2. LoadByReference - Load agent instance by slug (with optional org filtering)
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// - ValidateProto: Validates buf.validate constraints on ApiResourceReference
// - LoadByReference: Queries agent instances by slug, handles org-scoped and platform-scoped lookups
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorize step (no multi-tenant auth in OSS)
// - TransformResponse step (no response transformations in OSS)
// - SendResponse step (handler returns directly)
//
// Reference Lookup Logic:
// - If ref.org is provided: queries agent instances in that org with matching slug
// - If ref.org is empty: queries platform-scoped agent instances with matching slug
// - Slug is matched against metadata.name (slug is normalized name)
//
// The loaded agent instance is stored in context with key "targetResource" and
// returned by the handler.
func (c *AgentInstanceController) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*agentinstancev1.AgentInstance, error) {
	reqCtx := pipeline.NewRequestContext(ctx, ref)

	p := c.buildGetByReferencePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded agent instance from context
	instance := reqCtx.Get(steps.TargetResourceKey)
	if instance == nil {
		return nil, grpclib.InternalError(nil, "target agent instance not found in context")
	}

	return instance.(*agentinstancev1.AgentInstance), nil
}

// buildGetByReferencePipeline constructs the pipeline for get-by-reference operations
//
// This pipeline is generic and reusable across all resources.
// It uses standard steps from the pipeline/steps package.
func (c *AgentInstanceController) buildGetByReferencePipeline() *pipeline.Pipeline[*apiresource.ApiResourceReference] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*apiresource.ApiResourceReference]("agent-instance-get-by-reference").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceReference]()).       // 1. Validate input
		AddStep(steps.NewLoadByReferenceStep[*agentinstancev1.AgentInstance](c.store)). // 2. Load by slug
		Build()
}

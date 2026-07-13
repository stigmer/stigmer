package agentshare

import (
	"context"

	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// GetByReference retrieves an agent share by ApiResourceReference
// (org+slug lookup) using the pipeline framework.
//
// Pipeline Steps:
//  1. ValidateProto - Validate input ApiResourceReference
//  2. LoadByReference - Load the share by org+slug
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step
// (no multi-user auth).
func (c *AgentShareController) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*agentsharev1.AgentShare, error) {
	reqCtx := pipeline.NewRequestContext(ctx, ref)

	p := c.buildGetByReferencePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	share := reqCtx.Get(steps.TargetResourceKey)
	if share == nil {
		return nil, grpclib.InternalError(nil, "target agent share not found in context")
	}

	return share.(*agentsharev1.AgentShare), nil
}

func (c *AgentShareController) buildGetByReferencePipeline() *pipeline.Pipeline[*apiresource.ApiResourceReference] {
	return pipeline.NewPipeline[*apiresource.ApiResourceReference]("agent-share-get-by-reference").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceReference]()).
		AddStep(steps.NewLoadByReferenceStep[*agentsharev1.AgentShare](c.store)).
		Build()
}

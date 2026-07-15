package agentchannel

import (
	"context"

	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// GetByReference retrieves an agent channel by ApiResourceReference
// (org+slug lookup) using the pipeline framework.
//
// Pipeline Steps:
//  1. ValidateProto - Validate input ApiResourceReference
//  2. LoadByReference - Load the channel by org+slug
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step
// (no multi-user auth).
func (c *AgentChannelController) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*agentchannelv1.AgentChannel, error) {
	reqCtx := pipeline.NewRequestContext(ctx, ref)

	p := c.buildGetByReferencePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	channel := reqCtx.Get(steps.TargetResourceKey)
	if channel == nil {
		return nil, grpclib.InternalError(nil, "target agent channel not found in context")
	}

	return channel.(*agentchannelv1.AgentChannel), nil
}

func (c *AgentChannelController) buildGetByReferencePipeline() *pipeline.Pipeline[*apiresource.ApiResourceReference] {
	return pipeline.NewPipeline[*apiresource.ApiResourceReference]("agent-channel-get-by-reference").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceReference]()).
		AddStep(steps.NewLoadByReferenceStep[*agentchannelv1.AgentChannel](c.store)).
		Build()
}

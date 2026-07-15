package agentchannel

import (
	"context"

	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Get retrieves an agent channel by ID using the pipeline pattern.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (ID wrapper)
//  2. ExtractResourceId - Extract ID from AgentChannelId.Value wrapper
//  3. LoadTarget - Load the channel from the database
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step
// (no multi-user auth).
func (c *AgentChannelController) Get(ctx context.Context, channelId *agentchannelv1.AgentChannelId) (*agentchannelv1.AgentChannel, error) {
	reqCtx := pipeline.NewRequestContext(ctx, channelId)

	p := c.buildGetPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	target := reqCtx.Get(steps.TargetResourceKey)
	if target == nil {
		return nil, grpclib.InternalError(nil, "target agent channel not found in context")
	}

	return target.(*agentchannelv1.AgentChannel), nil
}

func (c *AgentChannelController) buildGetPipeline() *pipeline.Pipeline[*agentchannelv1.AgentChannelId] {
	return pipeline.NewPipeline[*agentchannelv1.AgentChannelId]("agent-channel-get").
		AddStep(steps.NewValidateProtoStep[*agentchannelv1.AgentChannelId]()).
		AddStep(steps.NewExtractResourceIdStep[*agentchannelv1.AgentChannelId]()).
		AddStep(steps.NewLoadTargetStep[*agentchannelv1.AgentChannelId, *agentchannelv1.AgentChannel](c.store)).
		Build()
}

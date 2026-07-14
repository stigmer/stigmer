package agentchannel

import (
	"context"

	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Delete deletes an agent channel by ID using the pipeline pattern.
//
// Delete is the connection's full teardown; disabling (update with
// enabled=false) is the config-preserving pause. The referenced agent is
// untouched.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (ID wrapper)
//  2. ExtractResourceId - Extract ID from AgentChannelId.Value wrapper
//  3. LoadExistingForDelete - Load the channel (stored in context for return)
//  4. DeleteResource - Delete the channel from the database
//
// No search-index cleanup: agent_channel is not_search_indexed.
//
// Note: Unlike Stigmer Cloud, OSS excludes:
//   - Authorization step (no multi-user auth)
//   - The teardown cascade (managed credentials environment, OAuth grant,
//     pending-delivery abandonment) — none of that state can exist here
//     because the install flow never runs in this edition (§0-b, see the
//     package comment)
//
// The deleted channel is returned for audit trail purposes (gRPC convention).
func (c *AgentChannelController) Delete(ctx context.Context, channelId *agentchannelv1.AgentChannelId) (*agentchannelv1.AgentChannel, error) {
	reqCtx := pipeline.NewRequestContext(ctx, channelId)

	p := c.buildDeletePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	deleted := reqCtx.Get(steps.ExistingResourceKey)
	if deleted == nil {
		return nil, grpclib.InternalError(nil, "deleted agent channel not found in context")
	}

	return deleted.(*agentchannelv1.AgentChannel), nil
}

func (c *AgentChannelController) buildDeletePipeline() *pipeline.Pipeline[*agentchannelv1.AgentChannelId] {
	return pipeline.NewPipeline[*agentchannelv1.AgentChannelId]("agent-channel-delete").
		AddStep(steps.NewValidateProtoStep[*agentchannelv1.AgentChannelId]()).
		AddStep(steps.NewExtractResourceIdStep[*agentchannelv1.AgentChannelId]()).
		AddStep(steps.NewLoadExistingForDeleteStep[*agentchannelv1.AgentChannelId, *agentchannelv1.AgentChannel](c.store)).
		AddStep(steps.NewDeleteResourceStep[*agentchannelv1.AgentChannelId](c.store)).
		Build()
}

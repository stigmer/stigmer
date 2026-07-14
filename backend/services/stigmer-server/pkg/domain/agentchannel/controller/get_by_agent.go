package agentchannel

import (
	"context"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// GetByAgent retrieves all channels of a specific agent, optionally scoped
// to one organization via the request's org field.
//
// This is how the agent's integrations surface and CLI resolve an agent's
// existing channels regardless of slug (channels are N-per-agent across
// providers, each with its own slug).
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints
//  2. LoadChannelsByAgent - Resolve the agent, filter channels by
//     agent_ref (and by metadata.org when the request carries an org)
//
// Note: Unlike Stigmer Cloud, OSS excludes authorization filtering
// (no multi-user auth - returns all of the agent's channels). The org
// filter is contract parity, not authorization: both editions must
// answer an org-scoped request identically.
func (c *AgentChannelController) GetByAgent(ctx context.Context, req *agentchannelv1.GetAgentChannelsByAgentRequest) (*agentchannelv1.AgentChannelList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildGetByAgentPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	list := reqCtx.Get(channelListKey)
	if list == nil {
		return nil, grpclib.InternalError(nil, "agent channel list not found in context")
	}

	return list.(*agentchannelv1.AgentChannelList), nil
}

func (c *AgentChannelController) buildGetByAgentPipeline() *pipeline.Pipeline[*agentchannelv1.GetAgentChannelsByAgentRequest] {
	return pipeline.NewPipeline[*agentchannelv1.GetAgentChannelsByAgentRequest]("agent-channel-get-by-agent").
		AddStep(steps.NewValidateProtoStep[*agentchannelv1.GetAgentChannelsByAgentRequest]()).
		AddStep(&loadChannelsByAgentStep{store: c.store}).
		Build()
}

const channelListKey = "agentChannelList"

// loadChannelsByAgentStep resolves the agent by ID to its org+slug
// identity, then filters channels whose spec.agent_ref matches.
//
// Channels reference agents by org+slug (the platform's canonical
// ApiResourceReference), while this RPC is keyed on the agent ID (the
// stable handle a detail view holds) — so the agent resolves first. A
// nonexistent agent yields an empty list, not an error: "no channels" is
// the useful answer for the integrations surface either way.
type loadChannelsByAgentStep struct {
	store store.Store
}

func (s *loadChannelsByAgentStep) Name() string {
	return "LoadChannelsByAgent"
}

func (s *loadChannelsByAgentStep) Execute(ctx *pipeline.RequestContext[*agentchannelv1.GetAgentChannelsByAgentRequest]) error {
	req := ctx.Input()

	emptyList := &agentchannelv1.AgentChannelList{TotalCount: 0, Items: []*agentchannelv1.AgentChannel{}}

	agent := &agentv1.Agent{}
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent, req.GetAgentId(), agent); err != nil {
		ctx.Set(channelListKey, emptyList)
		return nil
	}
	agentOrg := agent.GetMetadata().GetOrg()
	agentSlug := agent.GetMetadata().GetSlug()

	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_agent_channel)
	if err != nil {
		return grpclib.InternalError(err, "failed to list agent channels")
	}

	var channels []*agentchannelv1.AgentChannel
	for _, data := range resources {
		channel, ok := unmarshalChannel(data)
		if !ok {
			continue
		}

		ref := channel.GetSpec().GetAgentRef()
		if ref.GetOrg() != agentOrg || ref.GetSlug() != agentSlug {
			continue
		}
		// Org scope: a multi-org caller asking for one org's channels must
		// not see another org's channels of the same agent. (Channels are
		// same-org by invariant, so today this only excludes rows when
		// the requested org differs from the agent's — kept anyway for
		// contract parity with the sibling getByAgent RPCs.)
		if req.GetOrg() != "" && channel.GetMetadata().GetOrg() != req.GetOrg() {
			continue
		}
		channels = append(channels, channel)
	}

	ctx.Set(channelListKey, &agentchannelv1.AgentChannelList{
		TotalCount: int32(len(channels)),
		Items:      channels,
	})

	return nil
}

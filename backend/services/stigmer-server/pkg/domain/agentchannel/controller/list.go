package agentchannel

import (
	"context"
	"sort"

	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

const listResultKey = "listResult"

// List retrieves agent channels filtered by organization and optional
// labels.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (org is required)
//  2. ListByOrgAndLabels - Load all channels, filter by org and labels
//
// Note: Unlike Stigmer Cloud, OSS excludes:
// - Authorization filtering (no multi-user auth — returns all matching channels)
// - Pagination (returns all matching results)
func (c *AgentChannelController) List(ctx context.Context, req *agentchannelv1.ListAgentChannelsRequest) (*agentchannelv1.AgentChannelList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildListPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	list := reqCtx.Get(listResultKey)
	if list == nil {
		return nil, grpclib.InternalError(nil, "agent channel list not found in context")
	}

	return list.(*agentchannelv1.AgentChannelList), nil
}

func (c *AgentChannelController) buildListPipeline() *pipeline.Pipeline[*agentchannelv1.ListAgentChannelsRequest] {
	return pipeline.NewPipeline[*agentchannelv1.ListAgentChannelsRequest]("agent-channel-list").
		AddStep(steps.NewValidateProtoStep[*agentchannelv1.ListAgentChannelsRequest]()).
		AddStep(&listByOrgAndLabelsStep{store: c.store}).
		Build()
}

// listByOrgAndLabelsStep loads all agent channels and filters by org and
// labels (AND semantics), sorted by created_at descending (newest first).
type listByOrgAndLabelsStep struct {
	store store.Store
}

func (s *listByOrgAndLabelsStep) Name() string {
	return "ListByOrgAndLabels"
}

func (s *listByOrgAndLabelsStep) Execute(ctx *pipeline.RequestContext[*agentchannelv1.ListAgentChannelsRequest]) error {
	req := ctx.Input()
	org := req.GetOrg()
	reqLabels := req.GetLabels()

	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_agent_channel)
	if err != nil {
		return grpclib.InternalError(err, "failed to list agent channels")
	}

	channels := make([]*agentchannelv1.AgentChannel, 0, len(resources))
	for _, data := range resources {
		channel, ok := unmarshalChannel(data)
		if !ok {
			continue
		}

		if channel.GetMetadata().GetOrg() != org {
			continue
		}

		if !matchesAllLabels(channel.GetMetadata().GetLabels(), reqLabels) {
			continue
		}

		channels = append(channels, channel)
	}

	sort.Slice(channels, func(i, j int) bool {
		ti := channels[i].GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
		tj := channels[j].GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
		if ti == nil || tj == nil {
			return ti != nil
		}
		if ti.GetSeconds() != tj.GetSeconds() {
			return ti.GetSeconds() > tj.GetSeconds()
		}
		return ti.GetNanos() > tj.GetNanos()
	})

	ctx.Set(listResultKey, &agentchannelv1.AgentChannelList{
		TotalCount: int32(len(channels)),
		Items:      channels,
	})

	return nil
}

// matchesAllLabels returns true if resourceLabels contains every entry in
// filterLabels. An empty filterLabels map matches all resources.
func matchesAllLabels(resourceLabels, filterLabels map[string]string) bool {
	for k, v := range filterLabels {
		if resourceLabels[k] != v {
			return false
		}
	}
	return true
}

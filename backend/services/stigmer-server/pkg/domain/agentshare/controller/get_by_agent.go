package agentshare

import (
	"context"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// GetByAgent retrieves all shares of a specific agent.
//
// This is how the Share dialog and CLI resolve an agent's existing share
// regardless of its slug: a share whose slug diverged from the agent's
// (rename-by-recreate, decision 011 D2) stays discoverable.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints
//  2. LoadSharesByAgent - Resolve the agent, filter shares by agent_ref
//
// Note: Unlike Stigmer Cloud, OSS excludes authorization filtering
// (no multi-user auth - returns all of the agent's shares).
func (c *AgentShareController) GetByAgent(ctx context.Context, req *agentsharev1.GetAgentSharesByAgentRequest) (*agentsharev1.AgentShareList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildGetByAgentPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	list := reqCtx.Get(shareListKey)
	if list == nil {
		return nil, grpclib.InternalError(nil, "agent share list not found in context")
	}

	return list.(*agentsharev1.AgentShareList), nil
}

func (c *AgentShareController) buildGetByAgentPipeline() *pipeline.Pipeline[*agentsharev1.GetAgentSharesByAgentRequest] {
	return pipeline.NewPipeline[*agentsharev1.GetAgentSharesByAgentRequest]("agent-share-get-by-agent").
		AddStep(steps.NewValidateProtoStep[*agentsharev1.GetAgentSharesByAgentRequest]()).
		AddStep(&loadSharesByAgentStep{store: c.store}).
		Build()
}

const shareListKey = "agentShareList"

// loadSharesByAgentStep resolves the agent by ID to its org+slug identity,
// then filters shares whose spec.agent_ref matches.
//
// Shares reference agents by org+slug (the platform's canonical
// ApiResourceReference), while this RPC is keyed on the agent ID (the
// stable handle a detail view holds) — so the agent resolves first. A
// nonexistent agent yields an empty list, not an error: "no shares" is
// the useful answer for the Share dialog either way.
type loadSharesByAgentStep struct {
	store store.Store
}

func (s *loadSharesByAgentStep) Name() string {
	return "LoadSharesByAgent"
}

func (s *loadSharesByAgentStep) Execute(ctx *pipeline.RequestContext[*agentsharev1.GetAgentSharesByAgentRequest]) error {
	req := ctx.Input()

	emptyList := &agentsharev1.AgentShareList{TotalCount: 0, Items: []*agentsharev1.AgentShare{}}

	agent := &agentv1.Agent{}
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent, req.GetAgentId(), agent); err != nil {
		ctx.Set(shareListKey, emptyList)
		return nil
	}
	agentOrg := agent.GetMetadata().GetOrg()
	agentSlug := agent.GetMetadata().GetSlug()

	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_agent_share)
	if err != nil {
		return grpclib.InternalError(err, "failed to list agent shares")
	}

	var shares []*agentsharev1.AgentShare
	for _, data := range resources {
		share := &agentsharev1.AgentShare{}
		if err := proto.Unmarshal(data, share); err != nil {
			continue
		}

		ref := share.GetSpec().GetAgentRef()
		if ref.GetOrg() == agentOrg && ref.GetSlug() == agentSlug {
			shares = append(shares, share)
		}
	}

	ctx.Set(shareListKey, &agentsharev1.AgentShareList{
		TotalCount: int32(len(shares)),
		Items:      shares,
	})

	return nil
}

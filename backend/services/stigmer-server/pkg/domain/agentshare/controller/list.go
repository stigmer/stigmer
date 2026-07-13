package agentshare

import (
	"context"
	"sort"

	"github.com/rs/zerolog/log"
	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

const listResultKey = "listResult"

// List retrieves agent shares filtered by organization and optional labels.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (org is required)
//  2. ListByOrgAndLabels - Load all shares, filter by org and labels
//
// Note: Unlike Stigmer Cloud, OSS excludes:
// - Authorization filtering (no multi-user auth — returns all matching shares)
// - Pagination (returns all matching results)
func (c *AgentShareController) List(ctx context.Context, req *agentsharev1.ListAgentSharesRequest) (*agentsharev1.AgentShareList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildListPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	list := reqCtx.Get(listResultKey)
	if list == nil {
		return nil, grpclib.InternalError(nil, "agent share list not found in context")
	}

	return list.(*agentsharev1.AgentShareList), nil
}

func (c *AgentShareController) buildListPipeline() *pipeline.Pipeline[*agentsharev1.ListAgentSharesRequest] {
	return pipeline.NewPipeline[*agentsharev1.ListAgentSharesRequest]("agent-share-list").
		AddStep(steps.NewValidateProtoStep[*agentsharev1.ListAgentSharesRequest]()).
		AddStep(&listByOrgAndLabelsStep{store: c.store}).
		Build()
}

// listByOrgAndLabelsStep loads all agent shares and filters by org and
// labels (AND semantics), sorted by created_at descending (newest first).
type listByOrgAndLabelsStep struct {
	store store.Store
}

func (s *listByOrgAndLabelsStep) Name() string {
	return "ListByOrgAndLabels"
}

func (s *listByOrgAndLabelsStep) Execute(ctx *pipeline.RequestContext[*agentsharev1.ListAgentSharesRequest]) error {
	req := ctx.Input()
	org := req.GetOrg()
	reqLabels := req.GetLabels()

	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_agent_share)
	if err != nil {
		return grpclib.InternalError(err, "failed to list agent shares")
	}

	shares := make([]*agentsharev1.AgentShare, 0, len(resources))
	for _, data := range resources {
		share := &agentsharev1.AgentShare{}
		if err := proto.Unmarshal(data, share); err != nil {
			log.Warn().Err(err).Msg("Failed to unmarshal agent share, skipping")
			continue
		}

		if share.GetMetadata().GetOrg() != org {
			continue
		}

		if !matchesAllLabels(share.GetMetadata().GetLabels(), reqLabels) {
			continue
		}

		shares = append(shares, share)
	}

	sort.Slice(shares, func(i, j int) bool {
		ti := shares[i].GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
		tj := shares[j].GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
		if ti == nil || tj == nil {
			return ti != nil
		}
		if ti.GetSeconds() != tj.GetSeconds() {
			return ti.GetSeconds() > tj.GetSeconds()
		}
		return ti.GetNanos() > tj.GetNanos()
	})

	ctx.Set(listResultKey, &agentsharev1.AgentShareList{
		TotalCount: int32(len(shares)),
		Items:      shares,
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

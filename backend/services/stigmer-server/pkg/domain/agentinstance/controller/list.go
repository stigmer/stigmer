package agentinstance

import (
	"context"
	"sort"

	"github.com/rs/zerolog/log"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

const listResultKey = "listResult"

// List retrieves agent instances filtered by organization and optional labels.
//
// Pipeline Steps:
// 1. ValidateProto - Validate proto field constraints (org is required)
// 2. ListByOrgAndLabels - Load all agent instances, filter by org and labels
//
// Note: Unlike Stigmer Cloud, OSS excludes:
// - Authorization filtering (no multi-user auth — returns all matching instances)
// - Pagination (returns all matching results)
func (c *AgentInstanceController) List(ctx context.Context, req *agentinstancev1.ListAgentInstancesRequest) (*agentinstancev1.AgentInstanceList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildListPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	list := reqCtx.Get(listResultKey)
	if list == nil {
		return nil, grpclib.InternalError(nil, "agent instance list not found in context")
	}

	return list.(*agentinstancev1.AgentInstanceList), nil
}

func (c *AgentInstanceController) buildListPipeline() *pipeline.Pipeline[*agentinstancev1.ListAgentInstancesRequest] {
	return pipeline.NewPipeline[*agentinstancev1.ListAgentInstancesRequest]("agent-instance-list").
		AddStep(steps.NewValidateProtoStep[*agentinstancev1.ListAgentInstancesRequest]()).
		AddStep(newListByOrgAndLabelsStep(c.store)).
		Build()
}

// ============================================================================
// Custom Pipeline Step: ListByOrgAndLabels
// ============================================================================

// listByOrgAndLabelsStep loads all agent instances and filters by org and labels.
//
// This step:
// 1. Lists all agent instances from the store
// 2. Filters by metadata.org matching the requested org
// 3. Filters by metadata.labels containing all requested labels (AND semantics)
// 4. Sorts by created_at descending (newest first)
// 5. Stores the result list in pipeline context
//
// In OSS (local usage), no authorization filtering is applied.
type listByOrgAndLabelsStep struct {
	store store.Store
}

func newListByOrgAndLabelsStep(store store.Store) *listByOrgAndLabelsStep {
	return &listByOrgAndLabelsStep{store: store}
}

func (s *listByOrgAndLabelsStep) Name() string {
	return "ListByOrgAndLabels"
}

func (s *listByOrgAndLabelsStep) Execute(ctx *pipeline.RequestContext[*agentinstancev1.ListAgentInstancesRequest]) error {
	req := ctx.Input()
	org := req.GetOrg()
	reqLabels := req.GetLabels()

	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_agent_instance)
	if err != nil {
		return grpclib.InternalError(err, "failed to list agent instances")
	}

	instances := make([]*agentinstancev1.AgentInstance, 0, len(resources))
	for _, data := range resources {
		instance := &agentinstancev1.AgentInstance{}
		if err := proto.Unmarshal(data, instance); err != nil {
			log.Warn().Err(err).Msg("Failed to unmarshal agent instance, skipping")
			continue
		}

		if instance.GetMetadata().GetOrg() != org {
			continue
		}

		if !matchesAllLabels(instance.GetMetadata().GetLabels(), reqLabels) {
			continue
		}

		instances = append(instances, instance)
	}

	sort.Slice(instances, func(i, j int) bool {
		ti := instances[i].GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
		tj := instances[j].GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
		if ti == nil || tj == nil {
			return ti != nil
		}
		if ti.GetSeconds() != tj.GetSeconds() {
			return ti.GetSeconds() > tj.GetSeconds()
		}
		return ti.GetNanos() > tj.GetNanos()
	})

	log.Info().
		Str("org", org).
		Int("matchCount", len(instances)).
		Int("labelFilters", len(reqLabels)).
		Msg("Listed agent instances")

	ctx.Set(listResultKey, &agentinstancev1.AgentInstanceList{
		TotalCount: int32(len(instances)),
		Items:      instances,
	})

	return nil
}

// matchesAllLabels returns true if resourceLabels contains every entry in filterLabels.
// An empty filterLabels map matches all resources.
func matchesAllLabels(resourceLabels, filterLabels map[string]string) bool {
	for k, v := range filterLabels {
		if resourceLabels[k] != v {
			return false
		}
	}
	return true
}

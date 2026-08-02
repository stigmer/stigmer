package schedule

import (
	"context"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// GetByAgent retrieves all schedules of a specific agent, optionally
// scoped to one organization via the request's org field.
//
// This is how the agent's operational surfaces and CLI resolve an
// agent's existing schedules regardless of slug (schedules are
// N-per-agent with different prompts, each with its own slug).
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints
//  2. LoadSchedulesByAgent - Resolve the agent, filter schedules by
//     agent_ref (and by metadata.org when the request carries an org)
//
// Note: Unlike Stigmer Cloud, OSS excludes authorization filtering
// (no multi-user auth - returns all of the agent's schedules). The org
// filter is contract parity, not authorization: both editions must
// answer an org-scoped request identically.
func (c *ScheduleController) GetByAgent(ctx context.Context, req *schedulev1.GetSchedulesByAgentRequest) (*schedulev1.ScheduleList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildGetByAgentPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	list := reqCtx.Get(scheduleListKey)
	if list == nil {
		return nil, grpclib.InternalError(nil, "schedule list not found in context")
	}

	return list.(*schedulev1.ScheduleList), nil
}

func (c *ScheduleController) buildGetByAgentPipeline() *pipeline.Pipeline[*schedulev1.GetSchedulesByAgentRequest] {
	return pipeline.NewPipeline[*schedulev1.GetSchedulesByAgentRequest]("schedule-get-by-agent").
		AddStep(steps.NewValidateProtoStep[*schedulev1.GetSchedulesByAgentRequest]()).
		AddStep(&loadSchedulesByAgentStep{store: c.store}).
		Build()
}

const scheduleListKey = "scheduleList"

// loadSchedulesByAgentStep resolves the agent by ID to its org+slug
// identity, then filters schedules whose agent target matches.
//
// Schedules reference agents by org+slug (the platform's canonical
// ApiResourceReference), while this RPC is keyed on the agent ID (the
// stable handle a detail view holds) — so the agent resolves first. A
// nonexistent agent yields an empty list, not an error: "no schedules"
// is the useful answer for the operational surface either way.
type loadSchedulesByAgentStep struct {
	store store.Store
}

func (s *loadSchedulesByAgentStep) Name() string {
	return "LoadSchedulesByAgent"
}

func (s *loadSchedulesByAgentStep) Execute(ctx *pipeline.RequestContext[*schedulev1.GetSchedulesByAgentRequest]) error {
	req := ctx.Input()

	emptyList := &schedulev1.ScheduleList{TotalCount: 0, Items: []*schedulev1.Schedule{}}

	agent := &agentv1.Agent{}
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_agent, req.GetAgentId(), agent); err != nil {
		ctx.Set(scheduleListKey, emptyList)
		return nil
	}
	agentOrg := agent.GetMetadata().GetOrg()
	agentSlug := agent.GetMetadata().GetSlug()

	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_schedule)
	if err != nil {
		return grpclib.InternalError(err, "failed to list schedules")
	}

	var schedules []*schedulev1.Schedule
	for _, data := range resources {
		schedule, ok := unmarshalSchedule(data)
		if !ok {
			continue
		}

		ref := schedule.GetSpec().GetAgent().GetAgentRef()
		if ref.GetOrg() != agentOrg || ref.GetSlug() != agentSlug {
			continue
		}
		// Org scope: a multi-org caller asking for one org's schedules
		// must not see another org's schedules of the same agent.
		// (Schedules are same-org by invariant, so today this only
		// excludes rows when the requested org differs from the agent's
		// — kept anyway for contract parity with the sibling getByAgent
		// RPCs.)
		if req.GetOrg() != "" && schedule.GetMetadata().GetOrg() != req.GetOrg() {
			continue
		}
		schedules = append(schedules, schedule)
	}

	ctx.Set(scheduleListKey, &schedulev1.ScheduleList{
		TotalCount: int32(len(schedules)),
		Items:      schedules,
	})

	return nil
}

package schedule

import (
	"context"
	"sort"

	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

const listResultKey = "listResult"

// List retrieves schedules filtered by organization and optional labels.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (org is required)
//  2. ListByOrgAndLabels - Load all schedules, filter by org and labels
//
// Note: Unlike Stigmer Cloud, OSS excludes:
// - Authorization filtering (no multi-user auth — returns all matching schedules)
// - Pagination (returns all matching results)
func (c *ScheduleController) List(ctx context.Context, req *schedulev1.ListSchedulesRequest) (*schedulev1.ScheduleList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildListPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	list := reqCtx.Get(listResultKey)
	if list == nil {
		return nil, grpclib.InternalError(nil, "schedule list not found in context")
	}

	return list.(*schedulev1.ScheduleList), nil
}

func (c *ScheduleController) buildListPipeline() *pipeline.Pipeline[*schedulev1.ListSchedulesRequest] {
	return pipeline.NewPipeline[*schedulev1.ListSchedulesRequest]("schedule-list").
		AddStep(steps.NewValidateProtoStep[*schedulev1.ListSchedulesRequest]()).
		AddStep(&listByOrgAndLabelsStep{store: c.store}).
		Build()
}

// listByOrgAndLabelsStep loads all schedules and filters by org and
// labels (AND semantics), sorted by created_at descending (newest first).
type listByOrgAndLabelsStep struct {
	store store.Store
}

func (s *listByOrgAndLabelsStep) Name() string {
	return "ListByOrgAndLabels"
}

func (s *listByOrgAndLabelsStep) Execute(ctx *pipeline.RequestContext[*schedulev1.ListSchedulesRequest]) error {
	req := ctx.Input()
	org := req.GetOrg()
	reqLabels := req.GetLabels()

	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_schedule)
	if err != nil {
		return grpclib.InternalError(err, "failed to list schedules")
	}

	schedules := make([]*schedulev1.Schedule, 0, len(resources))
	for _, data := range resources {
		schedule, ok := unmarshalSchedule(data)
		if !ok {
			continue
		}

		if schedule.GetMetadata().GetOrg() != org {
			continue
		}

		if !matchesAllLabels(schedule.GetMetadata().GetLabels(), reqLabels) {
			continue
		}

		schedules = append(schedules, schedule)
	}

	sort.Slice(schedules, func(i, j int) bool {
		ti := schedules[i].GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
		tj := schedules[j].GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
		if ti == nil || tj == nil {
			return ti != nil
		}
		if ti.GetSeconds() != tj.GetSeconds() {
			return ti.GetSeconds() > tj.GetSeconds()
		}
		return ti.GetNanos() > tj.GetNanos()
	})

	ctx.Set(listResultKey, &schedulev1.ScheduleList{
		TotalCount: int32(len(schedules)),
		Items:      schedules,
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

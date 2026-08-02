package schedule

import (
	"context"

	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Delete deletes a schedule by ID using the pipeline pattern.
//
// Delete stops firing permanently; to stop firing while keeping the
// schedule and its history, disable it instead (update with
// enabled=false). The referenced agent and the executions created by
// past fires are untouched.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (ID wrapper)
//  2. ExtractResourceId - Extract ID from ScheduleId.Value wrapper
//  3. LoadExistingForDelete - Load the schedule (stored in context for return)
//  4. DeleteResource - Delete the schedule from the database
//
// No search-index cleanup: schedule is not_search_indexed.
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step (no
// multi-user auth). The Temporal artifact teardown (best-effort, AFTER
// the row delete — DD-008 D9) arrives with the clock in BOTH editions;
// until then delete is the row alone, and an orphaned artifact cannot
// exist because nothing creates one yet.
//
// The deleted schedule is returned for audit trail purposes (gRPC convention).
func (c *ScheduleController) Delete(ctx context.Context, scheduleId *schedulev1.ScheduleId) (*schedulev1.Schedule, error) {
	reqCtx := pipeline.NewRequestContext(ctx, scheduleId)

	p := c.buildDeletePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	deleted := reqCtx.Get(steps.ExistingResourceKey)
	if deleted == nil {
		return nil, grpclib.InternalError(nil, "deleted schedule not found in context")
	}

	return deleted.(*schedulev1.Schedule), nil
}

func (c *ScheduleController) buildDeletePipeline() *pipeline.Pipeline[*schedulev1.ScheduleId] {
	return pipeline.NewPipeline[*schedulev1.ScheduleId]("schedule-delete").
		AddStep(steps.NewValidateProtoStep[*schedulev1.ScheduleId]()).
		AddStep(steps.NewExtractResourceIdStep[*schedulev1.ScheduleId]()).
		AddStep(steps.NewLoadExistingForDeleteStep[*schedulev1.ScheduleId, *schedulev1.Schedule](c.store)).
		AddStep(steps.NewDeleteResourceStep[*schedulev1.ScheduleId](c.store)).
		Build()
}

package schedule

import (
	"context"

	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Get retrieves a schedule by ID using the pipeline pattern.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (ID wrapper)
//  2. ExtractResourceId - Extract ID from ScheduleId.Value wrapper
//  3. LoadTarget - Load the schedule from the database
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step
// (no multi-user auth).
func (c *ScheduleController) Get(ctx context.Context, scheduleId *schedulev1.ScheduleId) (*schedulev1.Schedule, error) {
	reqCtx := pipeline.NewRequestContext(ctx, scheduleId)

	p := c.buildGetPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	target := reqCtx.Get(steps.TargetResourceKey)
	if target == nil {
		return nil, grpclib.InternalError(nil, "target schedule not found in context")
	}

	return target.(*schedulev1.Schedule), nil
}

func (c *ScheduleController) buildGetPipeline() *pipeline.Pipeline[*schedulev1.ScheduleId] {
	return pipeline.NewPipeline[*schedulev1.ScheduleId]("schedule-get").
		AddStep(steps.NewValidateProtoStep[*schedulev1.ScheduleId]()).
		AddStep(steps.NewExtractResourceIdStep[*schedulev1.ScheduleId]()).
		AddStep(steps.NewLoadTargetStep[*schedulev1.ScheduleId, *schedulev1.Schedule](c.store)).
		Build()
}

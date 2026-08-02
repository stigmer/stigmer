package schedule

import (
	"context"

	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// GetByReference retrieves a schedule by ApiResourceReference (org+slug
// lookup) using the pipeline framework.
//
// Pipeline Steps:
//  1. ValidateProto - Validate input ApiResourceReference
//  2. LoadByReference - Load the schedule by org+slug
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step
// (no multi-user auth).
func (c *ScheduleController) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*schedulev1.Schedule, error) {
	reqCtx := pipeline.NewRequestContext(ctx, ref)

	p := c.buildGetByReferencePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	schedule := reqCtx.Get(steps.TargetResourceKey)
	if schedule == nil {
		return nil, grpclib.InternalError(nil, "target schedule not found in context")
	}

	return schedule.(*schedulev1.Schedule), nil
}

func (c *ScheduleController) buildGetByReferencePipeline() *pipeline.Pipeline[*apiresource.ApiResourceReference] {
	return pipeline.NewPipeline[*apiresource.ApiResourceReference]("schedule-get-by-reference").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceReference]()).
		AddStep(steps.NewLoadByReferenceStep[*schedulev1.Schedule](c.store)).
		Build()
}

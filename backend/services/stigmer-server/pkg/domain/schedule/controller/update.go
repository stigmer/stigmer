package schedule

import (
	"context"

	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Update updates an existing schedule using the pipeline framework.
//
// The spec is replaced wholesale (declarative semantics): a manifest
// that omits enabled disables firing — fails closed, matching every
// other resource. status is preserved verbatim from the existing
// schedule, which is the guarantee that keeps the firing observations
// and the platform auto-pause immune to declarative clobber (the
// scheduling runtime is their sole writer — DD-008 D7 / DD-009 pinned
// behaviors).
//
// Pipeline:
//  1. ValidateProto - Proto field constraints
//  2. ResolveSlug - Generate slug from metadata.name if unset
//  3. LoadExisting - Load the existing schedule by ID
//  4. ValidateScheduleUpdate - agent_ref and the target arm are
//     immutable; cron/timezone re-validated
//  5. BuildUpdateState - Merge spec, preserve id/slug/org, preserve
//     status
//  6. NormalizeReferences - Make references absolute (fill org)
//  7. Persist - Save the schedule
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step
// (cloud requires can_edit on the schedule).
func (c *ScheduleController) Update(ctx context.Context, schedule *schedulev1.Schedule) (*schedulev1.Schedule, error) {
	reqCtx := pipeline.NewRequestContext(ctx, schedule)

	p := c.buildUpdatePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

func (c *ScheduleController) buildUpdatePipeline() *pipeline.Pipeline[*schedulev1.Schedule] {
	return pipeline.NewPipeline[*schedulev1.Schedule]("schedule-update").
		AddStep(steps.NewValidateProtoStep[*schedulev1.Schedule]()).
		AddStep(steps.NewResolveSlugStep[*schedulev1.Schedule]()).
		AddStep(steps.NewLoadExistingStep[*schedulev1.Schedule](c.store)).
		AddStep(&validateScheduleUpdateStep{}).
		AddStep(steps.NewBuildUpdateStateStep[*schedulev1.Schedule]()).
		AddStep(steps.NewNormalizeReferencesStep[*schedulev1.Schedule]()).
		AddStep(steps.NewPersistStep[*schedulev1.Schedule](c.store)).
		Build()
}

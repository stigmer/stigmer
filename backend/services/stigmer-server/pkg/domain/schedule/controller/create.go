package schedule

import (
	"context"

	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Create creates a new schedule using the pipeline framework.
//
// Pipeline:
//  1. ValidateProto - Proto field constraints (incl. the required target
//     oneof and the agent_ref kind CEL rule)
//  2. ResolveScheduleDefaults - Require org, validate cron/timezone
//     grammar, normalize agent_ref, enforce the same-org invariant, load
//     the referenced agent
//  3. ResolveSlug - Generate slug from metadata.name (no agent-slug
//     default — schedules are N-per-agent, see ResolveScheduleDefaults)
//  4. CheckDuplicate - Org+slug uniqueness
//  5. BuildNewState - Set ID (sch_ prefix), clear client-provided status,
//     audit fields. The status wipe is the contract: status is
//     platform-owned and starts empty — nothing fires until the clock
//     lands, and no client may seed firing observations.
//  6. NormalizeReferences - Make references absolute (fill org)
//  7. Persist - Save the schedule
//
// No search-index step: schedule is not_search_indexed by design — a
// schedule is operational configuration reached through its target's
// surfaces, not a library artifact.
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step (cloud
// requires can_edit on the referenced agent, DD-009 C-6) and FGA tuple
// creation.
func (c *ScheduleController) Create(ctx context.Context, schedule *schedulev1.Schedule) (*schedulev1.Schedule, error) {
	reqCtx := pipeline.NewRequestContext(ctx, schedule)

	p := c.buildCreatePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

func (c *ScheduleController) buildCreatePipeline() *pipeline.Pipeline[*schedulev1.Schedule] {
	return pipeline.NewPipeline[*schedulev1.Schedule]("schedule-create").
		AddStep(steps.NewValidateProtoStep[*schedulev1.Schedule]()).
		AddStep(&resolveScheduleDefaultsStep{store: c.store}).
		AddStep(steps.NewResolveSlugStep[*schedulev1.Schedule]()).
		AddStep(steps.NewCheckDuplicateStep[*schedulev1.Schedule](c.store)).
		AddStep(steps.NewBuildNewStateStep[*schedulev1.Schedule]()).
		AddStep(steps.NewNormalizeReferencesStep[*schedulev1.Schedule]()).
		AddStep(steps.NewPersistStep[*schedulev1.Schedule](c.store)).
		Build()
}

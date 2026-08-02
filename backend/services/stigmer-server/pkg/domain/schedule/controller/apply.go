package schedule

import (
	"context"

	"github.com/rs/zerolog/log"
	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Apply creates or updates a schedule based on whether it already
// exists.
//
// This implements declarative "apply" semantics (similar to kubectl
// apply): schedule defaults resolve first — matching the cloud edition,
// which runs its defaults resolver BEFORE routing so the existence check
// sees the normalized agent_ref and the same-org invariant fails loudly
// before any routing — then existence decides create vs update. Status
// is preserved verbatim across apply-as-update (BuildUpdateState), so a
// routine manifest apply can never reset the failure streak or un-pause
// an auto-paused schedule (DD-008 D7 / DD-009 pinned behaviors).
//
// Pipeline (minimal - just for existence check):
//  1. ValidateProto - Validate field constraints
//  2. ResolveScheduleDefaults - Org invariant + cron/timezone grammar +
//     agent_ref normalization
//  3. ResolveSlug - Generate slug from metadata.name if still unset
//  4. LoadForApply - Attempt to load existing (doesn't fail if not found)
//
// The heavy lifting (validation, persistence, invariants) is handled by
// the delegated Create or Update handlers. Resolution is idempotent, so
// the create pipeline re-running ResolveScheduleDefaults over the
// resolved schedule is harmless.
func (c *ScheduleController) Apply(ctx context.Context, schedule *schedulev1.Schedule) (*schedulev1.Schedule, error) {
	reqCtx := pipeline.NewRequestContext(ctx, schedule)

	p := c.buildApplyPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	shouldCreateVal := reqCtx.Get(steps.ShouldCreateKey)
	if shouldCreateVal == nil {
		log.Error().Msg("Apply pipeline did not set shouldCreate flag")
		return nil, grpclib.InternalError(nil, "apply operation failed to determine create vs update")
	}

	// Delegate with the pipeline's state, not the original input: the
	// request context clones the input, so the normalized agent_ref
	// (from ResolveScheduleDefaults) and the populated id (from
	// LoadForApply) live on the clone.
	resolved := reqCtx.NewState()

	if shouldCreateVal.(bool) {
		log.Info().
			Str("slug", resolved.GetMetadata().GetSlug()).
			Msg("Schedule does not exist - delegating to CREATE")
		return c.Create(ctx, resolved)
	}

	log.Info().
		Str("slug", resolved.GetMetadata().GetSlug()).
		Str("id", resolved.GetMetadata().GetId()).
		Msg("Schedule exists - delegating to UPDATE")
	return c.Update(ctx, resolved)
}

func (c *ScheduleController) buildApplyPipeline() *pipeline.Pipeline[*schedulev1.Schedule] {
	return pipeline.NewPipeline[*schedulev1.Schedule]("schedule-apply").
		AddStep(steps.NewValidateProtoStep[*schedulev1.Schedule]()).
		AddStep(&resolveScheduleDefaultsStep{store: c.store}).
		AddStep(steps.NewResolveSlugStep[*schedulev1.Schedule]()).
		AddStep(steps.NewLoadForApplyStep[*schedulev1.Schedule](c.store)).
		Build()
}

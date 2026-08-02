package schedule

import (
	"context"

	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// Resume clears a platform auto-pause from a schedule.
//
// "Paused" is the platform's latch (status.paused_reason, written by the
// failure-streak auto-pause), distinct from "disabled", the owner's
// switch (spec.enabled) — project DD-013 D-E. Resume clears the latch
// and resets status.consecutive_failures, and is deliberately the ONLY
// path that does either (DD-013 D-D): update and apply preserve status
// verbatim, so a routine manifest apply can never silently un-pause a
// failing schedule.
//
// Resuming a schedule that is not paused (and has no failure streak)
// succeeds and changes nothing — no write, no audit bump. A disabled
// schedule stays disabled: the latch and the switch are independent.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (ID wrapper)
//  2. ExtractResourceId - Extract ID from ScheduleId.Value wrapper
//  3. LoadExistingForDelete - Load the schedule (NOT_FOUND if missing)
//  4. ClearSchedulePause - Clear paused_reason + reset the streak
//  5. PersistResumedSchedule - Save, skipped when nothing changed
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step (no
// multi-user auth; cloud requires can_edit on the schedule). OSS also
// persists the full row where cloud patches status leaves: OSS has no
// concurrent status writer until the slice-3 clock lands, which must
// revisit this deliberately (DD-013 D-D).
func (c *ScheduleController) Resume(ctx context.Context, scheduleId *schedulev1.ScheduleId) (*schedulev1.Schedule, error) {
	reqCtx := pipeline.NewRequestContext(ctx, scheduleId)

	p := c.buildResumePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	resumed := reqCtx.Get(steps.ExistingResourceKey)
	if resumed == nil {
		return nil, grpclib.InternalError(nil, "resumed schedule not found in context")
	}

	return resumed.(*schedulev1.Schedule), nil
}

// resumeChangedKey marks that the clear step actually cleared something,
// so the persist step can skip the write (and its audit bump) on the
// idempotent no-op path.
const resumeChangedKey = "resumeChanged"

func (c *ScheduleController) buildResumePipeline() *pipeline.Pipeline[*schedulev1.ScheduleId] {
	return pipeline.NewPipeline[*schedulev1.ScheduleId]("schedule-resume").
		AddStep(steps.NewValidateProtoStep[*schedulev1.ScheduleId]()).
		AddStep(steps.NewExtractResourceIdStep[*schedulev1.ScheduleId]()).
		AddStep(steps.NewLoadExistingForDeleteStep[*schedulev1.ScheduleId, *schedulev1.Schedule](c.store)).
		AddStep(&clearSchedulePauseStep{}).
		AddStep(&persistResumedScheduleStep{store: c.store}).
		Build()
}

// clearSchedulePauseStep clears status.paused_reason and resets
// status.consecutive_failures on the loaded schedule, preserving the rest
// of status — the rotate-share-link status-mutation discipline. When both
// are already clear it marks the pipeline as unchanged so persist can
// no-op.
type clearSchedulePauseStep struct{}

func (s *clearSchedulePauseStep) Name() string {
	return "ClearSchedulePause"
}

func (s *clearSchedulePauseStep) Execute(ctx *pipeline.RequestContext[*schedulev1.ScheduleId]) error {
	schedule := ctx.Get(steps.ExistingResourceKey).(*schedulev1.Schedule)

	status := schedule.GetStatus()
	if status.GetPausedReason() == "" && status.GetConsecutiveFailures() == 0 {
		ctx.Set(resumeChangedKey, false)
		return nil
	}

	if schedule.Status == nil {
		schedule.Status = &schedulev1.ScheduleStatus{}
	}
	schedule.Status.PausedReason = ""
	schedule.Status.ConsecutiveFailures = 0

	if err := steps.SetAuditFieldsForUpdate(schedule); err != nil {
		return grpclib.InternalError(err, "failed to set audit fields")
	}

	ctx.Set(steps.ExistingResourceKey, schedule)
	ctx.Set(resumeChangedKey, true)
	return nil
}

// persistResumedScheduleStep saves the resumed schedule, skipping the
// write entirely on the idempotent no-op path.
type persistResumedScheduleStep struct {
	store store.Store
}

func (s *persistResumedScheduleStep) Name() string {
	return "PersistResumedSchedule"
}

func (s *persistResumedScheduleStep) Execute(ctx *pipeline.RequestContext[*schedulev1.ScheduleId]) error {
	if changed, ok := ctx.Get(resumeChangedKey).(bool); ok && !changed {
		return nil
	}

	schedule := ctx.Get(steps.ExistingResourceKey).(*schedulev1.Schedule)
	err := s.store.SaveResource(ctx.Context(), apiresourcekind.ApiResourceKind_schedule,
		schedule.GetMetadata().GetId(), schedule)
	if err != nil {
		return grpclib.InternalError(err, "failed to save schedule")
	}

	return nil
}

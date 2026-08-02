package schedule

import (
	"context"
	"errors"

	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
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
//  4. ClearSchedulePause - Clear the latch + streak in ONE atomic
//     read-modify-write on the LIVE row (the DD-013 D-D revisit: the
//     clock is a concurrent status writer now, and the previous
//     load-mutate-save across step boundaries could revert a fire
//     recorded in the gap)
//  5. ArmResumedScheduleArtifact - Re-arm the clock so the un-pause
//     reaches Temporal NOW, and answer with a fresh next_fire_at
//     (non-critical; the reconciliation pass is the correctness path)
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step (no
// multi-user auth; cloud requires can_edit on the schedule).
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

func (c *ScheduleController) buildResumePipeline() *pipeline.Pipeline[*schedulev1.ScheduleId] {
	return pipeline.NewPipeline[*schedulev1.ScheduleId]("schedule-resume").
		AddStep(steps.NewValidateProtoStep[*schedulev1.ScheduleId]()).
		AddStep(steps.NewExtractResourceIdStep[*schedulev1.ScheduleId]()).
		AddStep(steps.NewLoadExistingForDeleteStep[*schedulev1.ScheduleId, *schedulev1.Schedule](c.store)).
		AddStep(&clearSchedulePauseStep{store: c.store}).
		AddStep(&armResumedScheduleStep{controller: c}).
		Build()
}

// errResumeNothingToClear aborts the atomic write on the idempotent
// no-op path — the fresh row has no latch and no streak, so nothing is
// written and no audit bumps.
var errResumeNothingToClear = errors.New("nothing to clear")

// clearSchedulePauseStep clears status.paused_reason and resets
// status.consecutive_failures in ONE store.UpdateResource closure on the
// freshly-read row, preserving every other status leaf as the concurrent
// runtime last wrote it.
//
// This is the revisit DD-013 D-D reserved for this slice: the previous
// implementation loaded the row in one step and full-row-saved it in
// another, which was safe only while nothing else wrote schedule status.
// The clock ended that — a fire recorded (or a streak advanced) between
// the load and the save would have been silently reverted. The
// agent-execution domain adopted this exact primitive after losing user
// approvals to the same race class.
type clearSchedulePauseStep struct {
	store store.Store
}

func (s *clearSchedulePauseStep) Name() string {
	return "ClearSchedulePause"
}

func (s *clearSchedulePauseStep) Execute(ctx *pipeline.RequestContext[*schedulev1.ScheduleId]) error {
	loaded := ctx.Get(steps.ExistingResourceKey).(*schedulev1.Schedule)
	scheduleID := loaded.GetMetadata().GetId()

	live := &schedulev1.Schedule{}
	err := s.store.UpdateResource(ctx.Context(), apiresourcekind.ApiResourceKind_schedule,
		scheduleID, live, func() error {
			status := live.GetStatus()
			if status.GetPausedReason() == "" && status.GetConsecutiveFailures() == 0 {
				return errResumeNothingToClear
			}
			live.Status.PausedReason = ""
			live.Status.ConsecutiveFailures = 0
			// Resuming with strikes left would re-pause on the next
			// failure — a lie; both clear together, always.
			if auditErr := steps.SetAuditFieldsForUpdate(live); auditErr != nil {
				return auditErr
			}
			return nil
		})
	switch {
	case err == nil, errors.Is(err, errResumeNothingToClear):
		// live holds the post-image (cleared, or the untouched fresh row
		// on the no-op path) — the honest response either way.
		ctx.Set(steps.ExistingResourceKey, live)
		return nil
	case errors.Is(err, store.ErrNotFound):
		// Deleted between load and clear: the delete won.
		return grpclib.NotFoundError("Schedule", scheduleID)
	default:
		return grpclib.InternalError(err, "failed to resume schedule")
	}
}

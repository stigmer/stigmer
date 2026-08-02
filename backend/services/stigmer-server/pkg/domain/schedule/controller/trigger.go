package schedule

import (
	"context"

	"github.com/rs/zerolog/log"
	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// The DD-014 D-B refusal copy, byte-identical to the cloud edition's
// ScheduleTriggerHandler (the backend-engineer rule: same error contracts
// in both editions; the conformance suite asserts these verbatim). A
// change on either side must change both.
const (
	// triggerDisabledMessage: the owner's switch is off. Honoring the
	// trigger anyway would need a "manual" marker the tick cannot receive
	// (Temporal bakes a schedule action's arguments once), so without the
	// refusal the fire would "succeed" and the tick's revalidation would
	// silently no-op it — the worst outcome (DD-014 D-B).
	triggerDisabledMessage = "schedule is disabled (spec.enabled=false) — enable it before triggering"

	// triggerPausedMessage: the platform's latch is set. Resume stays the
	// ONE clearing path (DD-013 D-D); the %s carries status.paused_reason
	// so the caller learns why without a second read.
	triggerPausedMessage = "schedule is paused by the platform (%s) — resume it before triggering"

	// triggerNoClockMessage: no scheduling runtime is wired into this
	// process (production wiring always injects it — this is the
	// defensive posture for embedded/test assemblies that skip server
	// wiring): refuse honestly, never pretend (the T02 slice-1
	// messaging-controller posture).
	triggerNoClockMessage = "this Stigmer server process has no scheduling clock wired — the schedule cannot fire"
)

// Trigger fires a schedule once, immediately (project DD-014).
//
// The manual fire runs through the schedule's own Temporal artifact —
// ONE fire path for cron and manual fires — so everything a cron fire
// does applies unchanged: revalidation, idempotent recording, run
// tracking, and the failure streak (DD-014 D-D). The fire is
// asynchronous: the response carries the schedule, and the run lands on
// status (last_fire_at / last_execution_id) as it starts.
//
// The refusal matrix runs first, for contract parity with cloud —
// NOT_FOUND for a missing schedule, FAILED_PRECONDITION for a disabled
// or platform-paused one, disabled checked first — asserted on both
// editions by the conformance suite.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (ID wrapper)
//  2. ExtractResourceId - Extract ID from ScheduleId.Value wrapper
//  3. LoadExistingForDelete - Load the schedule (NOT_FOUND if missing)
//  4. ValidateTriggerable - The DD-014 D-B refusal matrix
//  5. FireTrigger - Ensure the artifact (re-arms drift in-line), then
//     fire with ALLOW_ALL; Temporal unreachable answers UNAVAILABLE —
//     a manual fire is the one arming consumer that cannot "converge
//     later", so unlike the declarative writes it refuses honestly
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step (no
// multi-user auth; cloud requires can_edit on the schedule).
func (c *ScheduleController) Trigger(ctx context.Context, scheduleId *schedulev1.ScheduleId) (*schedulev1.Schedule, error) {
	reqCtx := pipeline.NewRequestContext(ctx, scheduleId)

	p := pipeline.NewPipeline[*schedulev1.ScheduleId]("schedule-trigger").
		AddStep(steps.NewValidateProtoStep[*schedulev1.ScheduleId]()).
		AddStep(steps.NewExtractResourceIdStep[*schedulev1.ScheduleId]()).
		AddStep(steps.NewLoadExistingForDeleteStep[*schedulev1.ScheduleId, *schedulev1.Schedule](c.store)).
		AddStep(&validateTriggerableStep{}).
		AddStep(&fireTriggerStep{controller: c}).
		Build()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	triggered := reqCtx.Get(steps.ExistingResourceKey)
	if triggered == nil {
		return nil, grpclib.InternalError(nil, "triggered schedule not found in context")
	}
	return triggered.(*schedulev1.Schedule), nil
}

// validateTriggerableStep enforces the DD-014 D-B refusal matrix on the
// loaded schedule: disabled first (the owner's switch), then paused (the
// platform's latch). Both are FAILED_PRECONDITION with teaching copy —
// a schedule in either state cannot fire, and pretending otherwise would
// let the tick's revalidation swallow the fire silently.
type validateTriggerableStep struct{}

func (s *validateTriggerableStep) Name() string {
	return "ValidateTriggerable"
}

func (s *validateTriggerableStep) Execute(ctx *pipeline.RequestContext[*schedulev1.ScheduleId]) error {
	schedule := ctx.Get(steps.ExistingResourceKey).(*schedulev1.Schedule)

	if !schedule.GetSpec().GetEnabled() {
		return grpclib.FailedPreconditionError(triggerDisabledMessage)
	}
	if reason := schedule.GetStatus().GetPausedReason(); reason != "" {
		return grpclib.FailedPreconditionError(triggerPausedMessage, reason)
	}
	return nil
}

// fireTriggerStep ensures the artifact (re-arming any drift in-line, so
// a trigger works even when the artifact was missing) and fires it once
// with ALLOW_ALL. Temporal being unreachable answers UNAVAILABLE — never
// a fake success the user would wait on. On success the fresh
// next_fire_at is mirrored into the response.
type fireTriggerStep struct {
	controller *ScheduleController
}

func (s *fireTriggerStep) Name() string {
	return "FireTrigger"
}

func (s *fireTriggerStep) Execute(ctx *pipeline.RequestContext[*schedulev1.ScheduleId]) error {
	clock := s.controller.clock
	if clock == nil {
		// No scheduling runtime wired at all (Temporal never configured
		// in this process) — the honest refusal, not a fake success.
		return grpclib.FailedPreconditionError(triggerNoClockMessage)
	}

	schedule := ctx.Get(steps.ExistingResourceKey).(*schedulev1.Schedule)
	scheduleID := schedule.GetMetadata().GetId()

	// Ensure-before-trigger: the one arming consumer that cannot
	// "converge later". A drifted or missing artifact is re-armed here;
	// what still fails after that is Temporal itself.
	nextFireAt, err := clock.EnsureAndRecord(ctx.Context(), schedule)
	if err != nil {
		log.Warn().Err(err).Str("schedule_id", scheduleID).
			Msg("Trigger could not arm the schedule artifact")
		return grpclib.UnavailableError("The scheduling engine is unavailable — try again shortly")
	}
	if err := clock.Trigger(ctx.Context(), scheduleID); err != nil {
		log.Warn().Err(err).Str("schedule_id", scheduleID).
			Msg("Trigger could not fire the schedule artifact")
		return grpclib.UnavailableError("The scheduling engine is unavailable — try again shortly")
	}

	if schedule.Status == nil {
		schedule.Status = &schedulev1.ScheduleStatus{}
	}
	if nextFireAt == nil {
		schedule.Status.NextFireAt = nil
	} else {
		schedule.Status.NextFireAt = timestamppb.New(*nextFireAt)
	}
	ctx.Set(steps.ExistingResourceKey, schedule)
	return nil
}

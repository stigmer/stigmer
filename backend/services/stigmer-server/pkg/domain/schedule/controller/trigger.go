package schedule

import (
	"context"
	"errors"
	"time"

	"github.com/rs/zerolog/log"
	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	scheduletemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/schedule/temporal"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// The trigger refusal copy, byte-identical to the cloud edition's
// ScheduleTriggerHandler (the backend-engineer rule: same error contracts
// in both editions; the conformance suite asserts these verbatim). A
// change on either side must change both.
const (
	// triggerDisabledMessage: the owner's switch is off. OSS has no
	// blueprint-access layer, so the refusal here is pure contract
	// parity: cloud MUST refuse (ScheduleBlueprintAccess requires
	// spec.enabled at the create gate AND the mid-run sandbox read
	// predicate — a disabled-schedule run would die mid-execution after
	// billing side effects, DD-017 D-5), and the two editions must not
	// diverge on a refusal a user can observe. Consoles turn the dead
	// end into a one-click "Enable & run now". The fire-legitimacy model
	// that would lift the refusal on both editions is DD-017's named
	// follow-up.
	triggerDisabledMessage = "schedule is disabled (spec.enabled=false) — enable it before triggering"

	// triggerNoRunnerMessage: no run starter is wired into this process
	// (production wiring always injects it — this is the defensive
	// posture for embedded/test assemblies that skip server wiring):
	// refuse honestly, never pretend (the T02 slice-1
	// messaging-controller posture).
	triggerNoRunnerMessage = "this Stigmer server process has no schedule run starter wired — the schedule cannot fire"
)

// Runner is the narrow slice of the scheduling runtime the trigger needs
// (satisfied by schedule/temporal.RunStarter): start one run through the
// full execution create pipeline and answer with the real outcome.
// Deliberately NOT the Clock — a manual fire needs no Temporal artifact
// (DD-017 D-5 amending DD-014 D-A): the artifact round-trip made the
// fire asynchronous, so the RPC answered "started" before the launch
// gates ran, which is exactly the false toast the owner hit.
type Runner interface {
	StartRun(ctx context.Context, schedule *schedulev1.Schedule, nominalFireTime time.Time) (scheduletemporal.RunOutcomeResult, error)
}

// SetRunner injects the run starter. Called from server wiring beside
// SetClock.
func (c *ScheduleController) SetRunner(runner Runner) {
	c.runner = runner
}

// Trigger fires a schedule once, immediately, and answers with the run's
// real outcome (project DD-017 D-5/D-6, amending DD-014).
//
// The manual fire runs SYNCHRONOUSLY through the standard execution
// create pipeline — every launch gate runs — and the result names what
// happened: the created execution's id, or the refusing gate's copy
// verbatim. Two-level contract: a gRPC error means the trigger itself
// was refused (missing → NOT_FOUND, disabled → FAILED_PRECONDITION); a
// gRPC success means the fire happened, whatever the run's outcome — a
// deterministically refused run is a successful trigger honestly
// reported, never an exception.
//
// Semantics settled by DD-017 D-5:
//   - A PAUSED schedule may be triggered (test-then-resume): a test fire
//     is exactly how an owner verifies a fix before resuming, and resume
//     stays the one path that clears the latch (DD-013 D-D).
//   - Manual fires do NOT feed the failure streak: the sync path is
//     untracked (the caller watches the execution), so it has no honest
//     completion verdict to contribute — and a test fire of a broken
//     schedule must not race its owner to the pause threshold.
//   - The handler stamps last_fire_at and writes the fire-ledger row
//     (origin=manual) because the tick is not in the path to do it; the
//     run starter stamps last_execution_id on success as it does for
//     cron fires.
//
// Pipeline Steps:
//  1. ValidateProto - Validate proto field constraints (ID wrapper)
//  2. ExtractResourceId - Extract ID from ScheduleId.Value wrapper
//  3. LoadExistingForDelete - Load the schedule (NOT_FOUND if missing)
//  4. ValidateTriggerable - Refuse disabled (contract parity with cloud)
//  5. FireDirectRun - Start the run in-process, stamp the fire, write
//     the ledger row, shape the result
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step (no
// multi-user auth; cloud requires can_edit on the schedule).
func (c *ScheduleController) Trigger(ctx context.Context, scheduleId *schedulev1.ScheduleId) (*schedulev1.ScheduleTriggerResult, error) {
	reqCtx := pipeline.NewRequestContext(ctx, scheduleId)

	p := pipeline.NewPipeline[*schedulev1.ScheduleId]("schedule-trigger").
		AddStep(steps.NewValidateProtoStep[*schedulev1.ScheduleId]()).
		AddStep(steps.NewExtractResourceIdStep[*schedulev1.ScheduleId]()).
		AddStep(steps.NewLoadExistingForDeleteStep[*schedulev1.ScheduleId, *schedulev1.Schedule](c.store)).
		AddStep(&validateTriggerableStep{}).
		AddStep(&fireDirectRunStep{controller: c}).
		Build()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	result, ok := reqCtx.Get(triggerResultKey).(*schedulev1.ScheduleTriggerResult)
	if !ok || result == nil {
		return nil, grpclib.InternalError(nil, "trigger result not found in context")
	}
	return result, nil
}

// triggerResultKey carries the shaped ScheduleTriggerResult from the
// fire step to the handler's return.
const triggerResultKey = "trigger_result"

// validateTriggerableStep refuses a disabled schedule (the owner's
// switch) — the ONE remaining trigger refusal (DD-017 D-5 narrowed
// DD-014 D-B's matrix: paused schedules are now triggerable, and the
// tick's revalidation no longer guards manual fires because manual fires
// no longer pass through the tick).
type validateTriggerableStep struct{}

func (s *validateTriggerableStep) Name() string {
	return "ValidateTriggerable"
}

func (s *validateTriggerableStep) Execute(ctx *pipeline.RequestContext[*schedulev1.ScheduleId]) error {
	schedule := ctx.Get(steps.ExistingResourceKey).(*schedulev1.Schedule)

	if !schedule.GetSpec().GetEnabled() {
		return grpclib.FailedPreconditionError(triggerDisabledMessage)
	}
	return nil
}

// fireDirectRunStep starts the run in-process and shapes the result:
// stamp last_fire_at, run the full create pipeline via the Runner, write
// the fire-ledger row, mirror the outcome into ScheduleTriggerResult.
// Infrastructure failures from the create pipeline propagate as the
// handler's error — the in-process client already speaks gRPC status.
type fireDirectRunStep struct {
	controller *ScheduleController
}

func (s *fireDirectRunStep) Name() string {
	return "FireDirectRun"
}

func (s *fireDirectRunStep) Execute(ctx *pipeline.RequestContext[*schedulev1.ScheduleId]) error {
	runner := s.controller.runner
	if runner == nil {
		return grpclib.FailedPreconditionError(triggerNoRunnerMessage)
	}

	schedule := ctx.Get(steps.ExistingResourceKey).(*schedulev1.Schedule)
	scheduleID := schedule.GetMetadata().GetId()

	// The manual fire's nominal time is the trigger instant, whole
	// seconds — the same identity the deterministic execution name uses,
	// so a manual fire at the exact cron nominal second converges on the
	// same execution via the ALREADY_EXISTS → re-find path.
	nominal := time.Now().UTC().Truncate(time.Second)
	nominalRFC3339 := nominal.Format(time.RFC3339)

	outcome, err := runner.StartRun(ctx.Context(), schedule, nominal)
	if err != nil {
		log.Warn().Err(err).Str("schedule_id", scheduleID).
			Msg("Manual trigger's run start failed on infrastructure")
		return err
	}

	// The fire happened: record it — last_fire_at on status (the tick is
	// not in this path to do it) and the ledger row (origin=manual).
	s.stampLastFireAt(ctx.Context(), scheduleID, nominal)
	scheduletemporal.RecordManualFire(ctx.Context(), s.controller.store,
		scheduleID, schedule.GetMetadata().GetOrg(), nominalRFC3339, outcome)

	result := &schedulev1.ScheduleTriggerResult{}
	switch o := outcome.(type) {
	case scheduletemporal.RunStartedOutcome:
		result.Outcome = schedulev1.ScheduleRunOutcome_SCHEDULE_RUN_OUTCOME_STARTED
		result.ExecutionId = o.ExecutionID
		log.Info().Str("schedule_id", scheduleID).Str("execution_id", o.ExecutionID).
			Bool("already_existed", o.AlreadyExisted).Msg("Schedule triggered manually — run started")
	case scheduletemporal.RunTargetMissingOutcome:
		result.Outcome = schedulev1.ScheduleRunOutcome_SCHEDULE_RUN_OUTCOME_TARGET_MISSING
		result.RefusalReason = o.Reason
		log.Warn().Str("schedule_id", scheduleID).Str("reason", o.Reason).
			Msg("Schedule triggered manually — target missing")
	case scheduletemporal.RunRefusedOutcome:
		result.Outcome = schedulev1.ScheduleRunOutcome_SCHEDULE_RUN_OUTCOME_REFUSED
		result.RefusalReason = o.Reason
		log.Warn().Str("schedule_id", scheduleID).Str("reason", o.Reason).
			Msg("Schedule triggered manually — run refused by a launch gate")
	default:
		return grpclib.InternalError(nil, "unknown run outcome from the run starter")
	}

	// Answer with the post-fire row — last_fire_at and (on success)
	// last_execution_id freshly stamped. A failed re-read degrades to
	// the loaded schedule rather than failing a fire that already
	// happened.
	fresh := &schedulev1.Schedule{}
	if readErr := s.controller.store.GetResource(ctx.Context(),
		apiresourcekind.ApiResourceKind_schedule, scheduleID, fresh); readErr == nil {
		result.Schedule = fresh
	} else {
		result.Schedule = schedule
	}

	ctx.Set(triggerResultKey, result)
	return nil
}

// stampLastFireAt records the manual fire on status — best-effort with a
// loud log: the run already started, and a bookkeeping failure must not
// turn a real fire into a caller-visible error. (The cron path's stamp
// rides the tick's recordFire; this is its manual twin.)
func (s *fireDirectRunStep) stampLastFireAt(ctx context.Context, scheduleID string, nominal time.Time) {
	live := &schedulev1.Schedule{}
	err := s.controller.store.UpdateResource(ctx, apiresourcekind.ApiResourceKind_schedule,
		scheduleID, live, func() error {
			if live.Status == nil {
				live.Status = &schedulev1.ScheduleStatus{}
			}
			live.Status.LastFireAt = timestamppb.New(nominal)
			return steps.SetAuditFieldsForUpdate(live)
		})
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		log.Warn().Err(err).Str("schedule_id", scheduleID).
			Msg("Manual fire's last_fire_at not stamped (best-effort — the run is unaffected)")
	}
}

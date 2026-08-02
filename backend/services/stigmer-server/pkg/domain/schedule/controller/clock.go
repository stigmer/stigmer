package schedule

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"
	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Clock is the narrow slice of the scheduling runtime the write paths
// need (satisfied by schedule/temporal.Syncer). Nil until the server
// wires it — and possibly forever, when Temporal was never configured:
// every consumer below degrades instead of refusing, because "no
// Temporal right now" is a supported OSS state (DD-015 D-A) and a
// declarative resource must be writable offline. The reconciliation pass
// converges whatever was written while the clock was away.
type Clock interface {
	// EnsureAndRecord converges the resource's Temporal artifact and
	// stamps status.next_fire_at; returns the stamp (nil when paused).
	EnsureAndRecord(ctx context.Context, schedule *schedulev1.Schedule) (*time.Time, error)
	// Teardown deletes the resource's artifact (not-found is success).
	Teardown(ctx context.Context, resourceID string) error
	// Trigger fires the artifact once, immediately (DD-014).
	Trigger(ctx context.Context, resourceID string) error
}

// SetClock injects the scheduling runtime. Called from server wiring
// after the Temporal manager exists; never called when Temporal was not
// configured at all.
func (c *ScheduleController) SetClock(clock Clock) {
	c.clock = clock
}

// armScheduleStep converges the artifact AFTER a successful write
// (create/update/apply — pipelines whose request is the Schedule) and
// mirrors the fresh next_fire_at into the response state.
//
// Non-critical in every outcome: a failed arm logs and succeeds, because
// the write already happened and the reconciliation pass is the
// correctness path. Refusing here would tear declarative writes away
// from offline use for no gain (DD-015 D-A).
type armScheduleStep struct {
	controller *ScheduleController
}

func (s *armScheduleStep) Name() string {
	return "ArmScheduleArtifact"
}

func (s *armScheduleStep) Execute(ctx *pipeline.RequestContext[*schedulev1.Schedule]) error {
	armAndMirror(ctx.Context(), s.controller.clock, ctx.NewState())
	return nil
}

// armResumedScheduleStep is the resume pipeline's arming step (request
// type ScheduleId; the resumed schedule lives under ExistingResourceKey).
// Re-arming is what makes resume answer with a fresh next_fire_at — the
// latch just cleared, so DesiredPaused flipped and the artifact must
// unpause NOW, not at the next sweep.
type armResumedScheduleStep struct {
	controller *ScheduleController
}

func (s *armResumedScheduleStep) Name() string {
	return "ArmResumedScheduleArtifact"
}

func (s *armResumedScheduleStep) Execute(ctx *pipeline.RequestContext[*schedulev1.ScheduleId]) error {
	schedule, ok := ctx.Get(steps.ExistingResourceKey).(*schedulev1.Schedule)
	if !ok || schedule == nil {
		return nil
	}
	armAndMirror(ctx.Context(), s.controller.clock, schedule)
	return nil
}

// armAndMirror runs the ensure and mirrors the stamp into the in-memory
// state the pipeline will answer with, so the response's next_fire_at
// matches what was just recorded on the row.
func armAndMirror(ctx context.Context, clock Clock, schedule *schedulev1.Schedule) {
	if clock == nil || schedule == nil {
		return
	}
	nextFireAt, err := clock.EnsureAndRecord(ctx, schedule)
	if err != nil {
		log.Warn().Err(err).Str("schedule_id", schedule.GetMetadata().GetId()).
			Msg("Schedule artifact not armed — next_fire_at stays absent until the reconciliation pass converges it")
		return
	}
	if schedule.Status == nil {
		schedule.Status = &schedulev1.ScheduleStatus{}
	}
	if nextFireAt == nil {
		schedule.Status.NextFireAt = nil
	} else {
		schedule.Status.NextFireAt = timestamppb.New(*nextFireAt)
	}
}

// teardownScheduleArtifactStep deletes the artifact AFTER the row delete
// (DD-008 D9: the row is the source of truth — a failed row delete must
// never tear down a live schedule's clock, so this step only ever runs
// once the delete succeeded). Non-critical: an orphaned artifact cannot
// fire past revalidation, and the reconciliation pass reaps it.
type teardownScheduleArtifactStep struct {
	controller *ScheduleController
}

func (s *teardownScheduleArtifactStep) Name() string {
	return "TeardownScheduleArtifact"
}

func (s *teardownScheduleArtifactStep) Execute(ctx *pipeline.RequestContext[*schedulev1.ScheduleId]) error {
	if s.controller.clock == nil {
		return nil
	}
	resourceID, _ := ctx.Get(steps.ResourceIdKey).(string)
	if resourceID == "" {
		return nil
	}
	if err := s.controller.clock.Teardown(ctx.Context(), resourceID); err != nil {
		log.Warn().Err(err).Str("schedule_id", resourceID).
			Msg("Schedule artifact teardown failed (non-fatal — the orphan cannot fire past revalidation and the reconciliation pass removes it)")
	}
	return nil
}

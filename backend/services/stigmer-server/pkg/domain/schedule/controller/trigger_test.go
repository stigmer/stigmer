package schedule

import (
	"context"
	"testing"
	"time"

	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	scheduletemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/schedule/temporal"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

// fakeRunner scripts the run starter's answer for one trigger.
type fakeRunner struct {
	outcome  scheduletemporal.RunOutcomeResult
	err      error
	started  int
	schedule *schedulev1.Schedule
}

func (f *fakeRunner) StartRun(ctx context.Context, schedule *schedulev1.Schedule, nominalFireTime time.Time) (scheduletemporal.RunOutcomeResult, error) {
	f.started++
	f.schedule = schedule
	if f.err != nil {
		return nil, f.err
	}
	return f.outcome, nil
}

// The trigger contract after project DD-017 D-5/D-6 (amending DD-014):
// synchronous direct run, real outcome in the response, disabled still
// refuses (byte-pinned copy — cloud carries the identical string and the
// conformance suite asserts it on both editions), paused now fires
// (test-then-resume), and manual fires never touch the failure streak.
func TestScheduleTrigger(t *testing.T) {
	t.Run("missing schedule answers NotFound", func(t *testing.T) {
		tc := newTestControllers(t)

		_, err := tc.schedules.Trigger(scheduleCtx(),
			&schedulev1.ScheduleId{Value: "sch_01MISSING"})
		if status.Code(err) != codes.NotFound {
			t.Fatalf("expected NOT_FOUND, got %s (%v)", status.Code(err), err)
		}
	})

	t.Run("disabled schedule refuses with the exact teaching copy", func(t *testing.T) {
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "trigger-disabled-agent")
		created := createTestSchedule(t, tc, agent, "trigger-disabled-schedule", false)

		_, err := tc.schedules.Trigger(scheduleCtx(),
			&schedulev1.ScheduleId{Value: created.GetMetadata().GetId()})
		if status.Code(err) != codes.FailedPrecondition {
			t.Fatalf("expected FAILED_PRECONDITION for a disabled schedule, got %s (%v)",
				status.Code(err), err)
		}
		if got := status.Convert(err).Message(); got != triggerDisabledMessage {
			t.Errorf("disabled refusal copy is contract (conformance asserts it on both editions);\n got:  %q\n want: %q",
				got, triggerDisabledMessage)
		}
	})

	t.Run("disabled refuses even when also paused", func(t *testing.T) {
		// A schedule can be both disabled AND paused; the owner's switch
		// is the one remaining refusal, whatever the latch says.
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "trigger-both-agent")
		created := createTestSchedule(t, tc, agent, "trigger-both-schedule", false)

		stored := proto.Clone(created).(*schedulev1.Schedule)
		stored.Status.PausedReason = "Paused after 5 consecutive failed runs."
		if err := tc.store.SaveResource(context.Background(),
			apiresourcekind.ApiResourceKind_schedule, stored.GetMetadata().GetId(), stored); err != nil {
			t.Fatalf("failed to seed pause on disabled schedule: %v", err)
		}

		_, err := tc.schedules.Trigger(scheduleCtx(),
			&schedulev1.ScheduleId{Value: created.GetMetadata().GetId()})
		if got := status.Convert(err).Message(); got != triggerDisabledMessage {
			t.Errorf("disabled must refuse regardless of the latch;\n got:  %q\n want: %q",
				got, triggerDisabledMessage)
		}
	})

	t.Run("paused schedule FIRES — test-then-resume (DD-017 D-5)", func(t *testing.T) {
		// DELIBERATE PIN REWRITE: DD-014 D-B refused paused schedules;
		// DD-017 D-5 reversed it — a test fire is exactly how an owner
		// verifies a fix before resuming. The latch itself must survive
		// the fire untouched (resume stays the ONE clearing path).
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "trigger-paused-agent")
		created := createTestSchedule(t, tc, agent, "trigger-paused-schedule", true)

		stored := proto.Clone(created).(*schedulev1.Schedule)
		stored.Status.PausedReason = "Paused after 5 consecutive failed runs. Last failure: run aex_01X ended failed"
		stored.Status.ConsecutiveFailures = 5
		if err := tc.store.SaveResource(context.Background(),
			apiresourcekind.ApiResourceKind_schedule, stored.GetMetadata().GetId(), stored); err != nil {
			t.Fatalf("failed to seed platform pause: %v", err)
		}

		runner := &fakeRunner{outcome: scheduletemporal.RunStartedOutcome{ExecutionID: "aex_01TEST"}}
		tc.schedules.SetRunner(runner)

		result, err := tc.schedules.Trigger(scheduleCtx(),
			&schedulev1.ScheduleId{Value: created.GetMetadata().GetId()})
		if err != nil {
			t.Fatalf("a paused schedule must fire on manual trigger, got %v", err)
		}
		if runner.started != 1 {
			t.Fatalf("expected exactly one run start, got %d", runner.started)
		}
		if result.GetOutcome() != schedulev1.ScheduleRunOutcome_SCHEDULE_RUN_OUTCOME_STARTED {
			t.Errorf("expected STARTED, got %s", result.GetOutcome())
		}
		if result.GetExecutionId() != "aex_01TEST" {
			t.Errorf("expected the created execution id, got %q", result.GetExecutionId())
		}
		// The latch and streak survive the fire untouched.
		if result.GetSchedule().GetStatus().GetPausedReason() == "" {
			t.Error("a manual fire must not clear the platform pause — resume is the one clearing path")
		}
		if got := result.GetSchedule().GetStatus().GetConsecutiveFailures(); got != 5 {
			t.Errorf("a manual fire must not touch the failure streak, got %d", got)
		}
	})

	t.Run("started run stamps last_fire_at and the manual ledger row", func(t *testing.T) {
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "trigger-started-agent")
		created := createTestSchedule(t, tc, agent, "trigger-started-schedule", true)

		runner := &fakeRunner{outcome: scheduletemporal.RunStartedOutcome{ExecutionID: "aex_01RUN"}}
		tc.schedules.SetRunner(runner)

		result, err := tc.schedules.Trigger(scheduleCtx(),
			&schedulev1.ScheduleId{Value: created.GetMetadata().GetId()})
		if err != nil {
			t.Fatalf("trigger failed: %v", err)
		}
		if result.GetSchedule().GetStatus().GetLastFireAt() == nil {
			t.Error("the manual fire must stamp last_fire_at — the tick is not in the path to do it")
		}

		runs, total, err := tc.store.ListScheduleRuns(
			context.Background(), created.GetMetadata().GetId(), 0, 10)
		if err != nil {
			t.Fatalf("list ledger rows: %v", err)
		}
		if total != 1 {
			t.Fatalf("expected exactly one ledger row, got %d", total)
		}
		if runs[0].Origin != "manual" {
			t.Errorf("expected origin=manual, got %q", runs[0].Origin)
		}
		if runs[0].Outcome != "started" {
			t.Errorf("expected outcome=started, got %q", runs[0].Outcome)
		}
		if runs[0].ExecutionID != "aex_01RUN" {
			t.Errorf("expected the execution id on the row, got %q", runs[0].ExecutionID)
		}
	})

	t.Run("refused run answers the gate's copy verbatim and leaves the streak alone", func(t *testing.T) {
		// The ISC failure mode, now honest end to end: the trigger
		// succeeds, the result names the refusing gate's copy, the
		// ledger row is terminal at insert, and the streak — the CRON
		// health signal — never moves for a manual test fire.
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "trigger-refused-agent")
		created := createTestSchedule(t, tc, agent, "trigger-refused-schedule", true)

		reason := "MCP server 'isc-gym' requires environment variable 'ISC_MCP_SHARED_SECRET' which is not provided."
		runner := &fakeRunner{outcome: scheduletemporal.RunRefusedOutcome{Reason: reason}}
		tc.schedules.SetRunner(runner)

		result, err := tc.schedules.Trigger(scheduleCtx(),
			&schedulev1.ScheduleId{Value: created.GetMetadata().GetId()})
		if err != nil {
			t.Fatalf("a deterministically refused run is a SUCCESSFUL trigger honestly reported, got %v", err)
		}
		if result.GetOutcome() != schedulev1.ScheduleRunOutcome_SCHEDULE_RUN_OUTCOME_REFUSED {
			t.Errorf("expected REFUSED, got %s", result.GetOutcome())
		}
		if result.GetRefusalReason() != reason {
			t.Errorf("the gate's copy must relay verbatim;\n got:  %q\n want: %q",
				result.GetRefusalReason(), reason)
		}
		if got := result.GetSchedule().GetStatus().GetConsecutiveFailures(); got != 0 {
			t.Errorf("a manual fire must not feed the failure streak, got %d", got)
		}

		runs, _, err := tc.store.ListScheduleRuns(
			context.Background(), created.GetMetadata().GetId(), 0, 10)
		if err != nil || len(runs) != 1 {
			t.Fatalf("expected one ledger row, got %d (%v)", len(runs), err)
		}
		if runs[0].Outcome != "refused" || runs[0].CompletedAt == "" {
			t.Errorf("a refused fire's row must be terminal at insert: outcome=%q completed_at=%q",
				runs[0].Outcome, runs[0].CompletedAt)
		}
	})

	t.Run("missing target answers TARGET_MISSING with the reason", func(t *testing.T) {
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "trigger-target-agent")
		created := createTestSchedule(t, tc, agent, "trigger-target-schedule", true)

		runner := &fakeRunner{outcome: scheduletemporal.RunTargetMissingOutcome{
			Reason: "target agent acme/gone not found"}}
		tc.schedules.SetRunner(runner)

		result, err := tc.schedules.Trigger(scheduleCtx(),
			&schedulev1.ScheduleId{Value: created.GetMetadata().GetId()})
		if err != nil {
			t.Fatalf("trigger failed: %v", err)
		}
		if result.GetOutcome() != schedulev1.ScheduleRunOutcome_SCHEDULE_RUN_OUTCOME_TARGET_MISSING {
			t.Errorf("expected TARGET_MISSING, got %s", result.GetOutcome())
		}
		if result.GetRefusalReason() != "target agent acme/gone not found" {
			t.Errorf("unexpected reason %q", result.GetRefusalReason())
		}
	})

	t.Run("an unwired controller refuses honestly instead of pretending to fire", func(t *testing.T) {
		// These controllers have no runner injected (SetRunner never ran)
		// — the defensive posture for assemblies that skip server wiring.
		// Production wiring always injects it beside the clock.
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "trigger-norunner-agent")
		created := createTestSchedule(t, tc, agent, "trigger-norunner-schedule", true)

		_, err := tc.schedules.Trigger(scheduleCtx(),
			&schedulev1.ScheduleId{Value: created.GetMetadata().GetId()})
		if status.Code(err) != codes.FailedPrecondition {
			t.Fatalf("expected FAILED_PRECONDITION while no runner exists, got %s (%v)",
				status.Code(err), err)
		}
		if got := status.Convert(err).Message(); got != triggerNoRunnerMessage {
			t.Errorf("no-runner refusal copy;\n got:  %q\n want: %q", got, triggerNoRunnerMessage)
		}
	})
}

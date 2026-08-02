package schedule

import (
	"context"
	"fmt"
	"testing"

	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

// The DD-014 D-B refusal matrix, pinned byte-for-byte: the cloud handler
// carries the identical copy (ScheduleTriggerHandlerTest pins its side),
// and the conformance suite asserts these strings against BOTH editions —
// they are contract, not prose.
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

	t.Run("platform-paused schedule refuses, naming the pause reason", func(t *testing.T) {
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "trigger-paused-agent")
		created := createTestSchedule(t, tc, agent, "trigger-paused-schedule", true)

		stored := proto.Clone(created).(*schedulev1.Schedule)
		stored.Status.PausedReason = "Paused after 5 consecutive failed runs. Last failure: run aex_01X ended failed"
		if err := tc.store.SaveResource(context.Background(),
			apiresourcekind.ApiResourceKind_schedule, stored.GetMetadata().GetId(), stored); err != nil {
			t.Fatalf("failed to seed platform pause: %v", err)
		}

		_, err := tc.schedules.Trigger(scheduleCtx(),
			&schedulev1.ScheduleId{Value: created.GetMetadata().GetId()})
		if status.Code(err) != codes.FailedPrecondition {
			t.Fatalf("expected FAILED_PRECONDITION for a paused schedule, got %s (%v)",
				status.Code(err), err)
		}
		want := fmt.Sprintf(triggerPausedMessage, stored.GetStatus().GetPausedReason())
		if got := status.Convert(err).Message(); got != want {
			t.Errorf("paused refusal copy is contract;\n got:  %q\n want: %q", got, want)
		}
	})

	t.Run("disabled wins over paused — the owner's switch is checked first", func(t *testing.T) {
		// A schedule can be both disabled AND paused. The matrix order is
		// contract (both editions pin it): the owner's switch is the outer
		// state — teaching "enable it" before "resume it" matches the
		// order the user must act in anyway.
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
			t.Errorf("disabled must be checked before paused;\n got:  %q\n want: %q",
				got, triggerDisabledMessage)
		}
	})

	t.Run("an unwired controller refuses honestly instead of pretending to fire", func(t *testing.T) {
		// These controllers have no clock injected (SetClock never ran) —
		// the defensive posture for assemblies that skip server wiring.
		// Production wiring always injects the clock; its fire path is
		// proven end-to-end by the conformance firing suite.
		tc := newTestControllers(t)
		agent := createTestAgent(t, tc, "trigger-noclock-agent")
		created := createTestSchedule(t, tc, agent, "trigger-noclock-schedule", true)

		_, err := tc.schedules.Trigger(scheduleCtx(),
			&schedulev1.ScheduleId{Value: created.GetMetadata().GetId()})
		if status.Code(err) != codes.FailedPrecondition {
			t.Fatalf("expected FAILED_PRECONDITION while no clock exists, got %s (%v)",
				status.Code(err), err)
		}
		if got := status.Convert(err).Message(); got != triggerNoClockMessage {
			t.Errorf("no-clock refusal copy;\n got:  %q\n want: %q", got, triggerNoClockMessage)
		}
	})
}

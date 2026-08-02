package temporal

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"go.temporal.io/sdk/client"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Activity tests run against a real SQLite store (the controller-test
// posture) with a Temporal-less syncer: the client provider returns nil,
// which every syncer method degrades on — exactly the offline daemon
// state, so these tests also pin that the clock's status writes never
// require Temporal.

func seedSchedule(t *testing.T, st store.Store, mutate func(*schedulev1.Schedule)) *schedulev1.Schedule {
	t.Helper()
	schedule := &schedulev1.Schedule{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Schedule",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "sch_01ACTIVITYTEST",
			Org:  "acme",
			Slug: "fee-reminders",
			Name: "fee-reminders",
		},
		Spec: &schedulev1.ScheduleSpec{
			Cron:     "0 9 * * *",
			TimeZone: "Asia/Kolkata",
			Enabled:  true,
			Target: &schedulev1.ScheduleSpec_Agent{Agent: &schedulev1.AgentTarget{
				AgentRef: &apiresource.ApiResourceReference{
					Kind: apiresourcekind.ApiResourceKind_agent, Org: "acme", Slug: "fee-bot"},
				Message: "Send fee reminders.",
			}},
		},
		Status: &schedulev1.ScheduleStatus{},
	}
	if mutate != nil {
		mutate(schedule)
	}
	require.NoError(t, st.SaveResource(context.Background(),
		apiresourcekind.ApiResourceKind_schedule, schedule.GetMetadata().GetId(), schedule))
	return schedule
}

func newActivities(t *testing.T) (*TickActivities, store.Store, *Config) {
	t.Helper()
	st, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	require.NoError(t, err)
	t.Cleanup(func() { st.Close() })

	config := LoadConfig()
	syncer := NewSyncer(func() client.Client { return nil }, st, NewArtifact(config))
	activities := NewTickActivities(st, config, syncer, NewRunStarter(st, config, nil))
	return activities, st, config
}

func timestamppbNow(t *testing.T) *timestamppb.Timestamp {
	t.Helper()
	return timestamppb.New(time.Now().Truncate(time.Second))
}

func reloadSchedule(t *testing.T, st store.Store, id string) *schedulev1.Schedule {
	t.Helper()
	schedule := &schedulev1.Schedule{}
	require.NoError(t, st.GetResource(context.Background(),
		apiresourcekind.ApiResourceKind_schedule, id, schedule))
	return schedule
}

func TestRecordTick_RevalidationMatrix(t *testing.T) {
	t.Run("deleted row is a no-op — the invariant that makes orphaned artifacts harmless", func(t *testing.T) {
		activities, _, _ := newActivities(t)
		outcome, err := activities.RecordTick(context.Background(), "sch_01GONE", "2026-08-03T09:00:00Z")
		require.NoError(t, err)
		require.Equal(t, TickSkippedDeleted, outcome)
	})

	t.Run("owner-disabled row declines the fire and writes nothing", func(t *testing.T) {
		activities, st, _ := newActivities(t)
		seeded := seedSchedule(t, st, func(s *schedulev1.Schedule) { s.Spec.Enabled = false })

		outcome, err := activities.RecordTick(context.Background(),
			seeded.GetMetadata().GetId(), "2026-08-03T09:00:00Z")

		require.NoError(t, err)
		require.Equal(t, TickSkippedDisabled, outcome)
		require.Nil(t, reloadSchedule(t, st, seeded.GetMetadata().GetId()).GetStatus().GetLastFireAt(),
			"a declined fire must not be recorded")
	})

	t.Run("platform-paused row declines the fire", func(t *testing.T) {
		activities, st, _ := newActivities(t)
		seeded := seedSchedule(t, st, func(s *schedulev1.Schedule) {
			s.Status.PausedReason = "Paused after 5 consecutive failed runs."
		})

		outcome, err := activities.RecordTick(context.Background(),
			seeded.GetMetadata().GetId(), "2026-08-03T09:00:00Z")

		require.NoError(t, err)
		require.Equal(t, TickSkippedAutoPaused, outcome)
	})
}

func TestRecordTick_RecordsTheNominalTimeIdempotently(t *testing.T) {
	activities, st, _ := newActivities(t)
	seeded := seedSchedule(t, st, nil)
	id := seeded.GetMetadata().GetId()

	outcome, err := activities.RecordTick(context.Background(), id, "2026-08-03T09:00:00Z")
	require.NoError(t, err)
	require.Equal(t, TickFired, outcome)

	first := reloadSchedule(t, st, id)
	require.Equal(t, int64(time.Date(2026, 8, 3, 9, 0, 0, 0, time.UTC).Unix()),
		first.GetStatus().GetLastFireAt().GetSeconds(),
		"last_fire_at is the NOMINAL time, not wall-clock")

	// An activity retry writes the identical value — idempotent by
	// construction, no double-fire visible to any reader.
	_, err = activities.RecordTick(context.Background(), id, "2026-08-03T09:00:00Z")
	require.NoError(t, err)
	require.Equal(t, first.GetStatus().GetLastFireAt().GetSeconds(),
		reloadSchedule(t, st, id).GetStatus().GetLastFireAt().GetSeconds())
}

func TestPollExecutionPhase_Classification(t *testing.T) {
	activities, st, _ := newActivities(t)

	seedExecution := func(id string, phase agentexecutionv1.ExecutionPhase) {
		execution := &agentexecutionv1.AgentExecution{
			Metadata: &apiresource.ApiResourceMetadata{Id: id, Org: "acme", Slug: id, Name: id},
			Status:   &agentexecutionv1.AgentExecutionStatus{Phase: phase},
		}
		require.NoError(t, st.SaveResource(context.Background(),
			apiresourcekind.ApiResourceKind_agent_execution, id, execution))
	}

	cases := []struct {
		phase agentexecutionv1.ExecutionPhase
		want  RunPhase
	}{
		{agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, PhaseCompleted},
		{agentexecutionv1.ExecutionPhase_EXECUTION_FAILED, PhaseFailed},
		{agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED, PhaseCancelled},
		{agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED, PhaseTerminated},
		// Non-terminal phases — including the gates — are all RUNNING.
		{agentexecutionv1.ExecutionPhase_EXECUTION_PENDING, PhaseRunning},
		{agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS, PhaseRunning},
		{agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL, PhaseRunning},
		{agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED, PhaseRunning},
		{agentexecutionv1.ExecutionPhase_EXECUTION_PHASE_UNSPECIFIED, PhaseRunning},
	}
	for i, tc := range cases {
		id := fmt.Sprintf("aex_01PHASE%02d", i)
		seedExecution(id, tc.phase)
		got, err := activities.PollExecutionPhase(context.Background(), id)
		require.NoError(t, err)
		require.Equal(t, tc.want, got, "phase %s", tc.phase)
	}

	t.Run("a deleted row is GONE, distinct from RUNNING — deleting a run must not brick its schedule", func(t *testing.T) {
		got, err := activities.PollExecutionPhase(context.Background(), "aex_01NEVEREXISTED")
		require.NoError(t, err)
		require.Equal(t, PhaseGone, got)
	})
}

func TestRecordFailedRun_StreakContract(t *testing.T) {
	// The exact contract the cloud pins in its repo contract tests: the
	// increment reads the live value atomically, the pause latches only
	// AT the crossing and only when no reason is set, an existing reason
	// is never rewritten, next_fire_at clears at/past the threshold, and
	// a deleted row is a no-op.
	t.Setenv("STIGMER_SCHEDULES_MAX_CONSECUTIVE_FAILURES", "2")

	t.Run("below threshold: increment, no pause", func(t *testing.T) {
		activities, st, _ := newActivities(t)
		seeded := seedSchedule(t, st, nil)

		recorded, err := activities.RecordFailedRun(context.Background(),
			seeded.GetMetadata().GetId(), "target agent acme/fee-bot not found", FailureStartFailed)

		require.NoError(t, err)
		require.Equal(t, 1, recorded.ConsecutiveFailures)
		require.False(t, recorded.Paused)
		require.Empty(t, reloadSchedule(t, st, seeded.GetMetadata().GetId()).GetStatus().GetPausedReason())
	})

	t.Run("the crossing write latches the pause with the exact teaching copy and clears next_fire_at", func(t *testing.T) {
		activities, st, _ := newActivities(t)
		seeded := seedSchedule(t, st, func(s *schedulev1.Schedule) {
			s.Status.ConsecutiveFailures = 1
			s.Status.NextFireAt = timestamppbNow(t)
		})

		recorded, err := activities.RecordFailedRun(context.Background(),
			seeded.GetMetadata().GetId(), "target agent acme/fee-bot not found", FailureStartFailed)

		require.NoError(t, err)
		require.Equal(t, 2, recorded.ConsecutiveFailures)
		require.True(t, recorded.Paused)

		stored := reloadSchedule(t, st, seeded.GetMetadata().GetId())
		require.Equal(t,
			"Paused after 2 consecutive failed runs. Last failure: target agent acme/fee-bot not found",
			stored.GetStatus().GetPausedReason(),
			"the pause copy is cross-edition contract (the conformance suite asserts it)")
		require.Nil(t, stored.GetStatus().GetNextFireAt(),
			"a paused schedule must advertise no fire it will decline")
	})

	t.Run("past the threshold the first pause's copy is never rewritten", func(t *testing.T) {
		activities, st, _ := newActivities(t)
		seeded := seedSchedule(t, st, func(s *schedulev1.Schedule) {
			s.Status.ConsecutiveFailures = 2
			s.Status.PausedReason = "Paused after 2 consecutive failed runs. Last failure: THE ORIGINAL"
		})

		recorded, err := activities.RecordFailedRun(context.Background(),
			seeded.GetMetadata().GetId(), "a different, later failure", FailureRunFailed)

		require.NoError(t, err)
		require.Equal(t, 3, recorded.ConsecutiveFailures)
		require.True(t, recorded.Paused)
		require.Equal(t,
			"Paused after 2 consecutive failed runs. Last failure: THE ORIGINAL",
			reloadSchedule(t, st, seeded.GetMetadata().GetId()).GetStatus().GetPausedReason(),
			"the first pause explains the pause; later strikes must not rewrite history")
	})

	t.Run("a deleted row is a silent no-op — deleting a schedule mid-track must not resurrect it", func(t *testing.T) {
		activities, _, _ := newActivities(t)
		recorded, err := activities.RecordFailedRun(context.Background(),
			"sch_01DELETEDMIDTRACK", "whatever", FailureRunFailed)
		require.NoError(t, err)
		require.Zero(t, recorded.ConsecutiveFailures)
		require.False(t, recorded.Paused)
	})
}

func TestRecordSuccessfulRun_ResetsToAbsorbingZero(t *testing.T) {
	activities, st, _ := newActivities(t)
	seeded := seedSchedule(t, st, func(s *schedulev1.Schedule) {
		s.Status.ConsecutiveFailures = 4
		s.Status.LastExecutionId = "aex_01KEEP"
	})

	require.NoError(t, activities.RecordSuccessfulRun(context.Background(), seeded.GetMetadata().GetId()))

	stored := reloadSchedule(t, st, seeded.GetMetadata().GetId())
	require.Zero(t, stored.GetStatus().GetConsecutiveFailures())
	require.Equal(t, "aex_01KEEP", stored.GetStatus().GetLastExecutionId(),
		"the reset touches the streak, nothing else")

	// Idempotent: the caller retries this freely (a LOST reset strands a
	// stale streak that pauses a healthy schedule later).
	require.NoError(t, activities.RecordSuccessfulRun(context.Background(), seeded.GetMetadata().GetId()))
	require.NoError(t, activities.RecordSuccessfulRun(context.Background(), "sch_01GONE"),
		"resetting a deleted schedule is a no-op, not an error")
}

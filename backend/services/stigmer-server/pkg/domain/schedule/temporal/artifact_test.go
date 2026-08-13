package temporal

import (
	"testing"
	"time"

	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stretchr/testify/require"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/client"
)

// The ONE resource-to-Temporal mapping, pinned because the baked action
// is invisible to listSchedules — whatever the mapping writes is final
// for every artifact it creates. The identity constants are cross-repo
// contract (the cloud ScheduleArtifact and the integration harness's
// ScheduleInspector pin the same strings).

func TestArtifactIdentityContract(t *testing.T) {
	require.Equal(t, "schedule/tick", TickWorkflowType)
	require.Equal(t, "schedule/tick/sch_01TEST", ArtifactID("sch_01TEST"))
	require.Equal(t, "sch_01TEST", ResourceIDOf("schedule/tick/sch_01TEST"), "the id round-trips")
}

func TestNote_IsTheDriftFingerprint(t *testing.T) {
	// Cron does NOT round-trip (the server compiles it to calendar
	// specs), so the note is the only spec-change detector the
	// reconciliation pass has. Format pinned across editions.
	schedule := seedSchedule2(t, nil)
	require.Equal(t, "cron=0 9 * * * tz=Asia/Kolkata", Note(schedule))
}

func TestDesiredPaused_TwoLeversOneArtifactState(t *testing.T) {
	require.False(t, DesiredPaused(seedSchedule2(t, nil)))
	require.True(t, DesiredPaused(seedSchedule2(t, func(s *schedulev1.Schedule) {
		s.Spec.Enabled = false
	})), "disabled — the owner's switch")
	require.True(t, DesiredPaused(seedSchedule2(t, func(s *schedulev1.Schedule) {
		s.Status.PausedReason = "Paused after 5 consecutive failed runs."
	})), "paused — the platform's latch")
}

func TestCreateOptions_PinnedPolicy(t *testing.T) {
	artifact := NewArtifact(LoadConfig())
	schedule := seedSchedule2(t, nil)

	options := artifact.CreateOptions(schedule)

	require.Equal(t, "schedule/tick/sch_01TEST", options.ID)
	require.Equal(t, []string{"0 9 * * *"}, options.Spec.CronExpressions)
	require.Equal(t, "Asia/Kolkata", options.Spec.TimeZoneName)
	require.Equal(t, enumspb.SCHEDULE_OVERLAP_POLICY_SKIP, options.Overlap,
		"SKIP must be explicit — a tracked tick makes it real (DD-008 D6)")
	require.Equal(t, 60*time.Minute, options.CatchupWindow,
		"the laptop that slept through 9am fires within the hour after the daemon returns")
	require.False(t, options.PauseOnFailure,
		"Temporal must never pause behind the platform's back — it would oscillate against reconciliation")
	require.False(t, options.Paused)
	require.Equal(t, "cron=0 9 * * * tz=Asia/Kolkata", options.Note)

	action, ok := options.Action.(*client.ScheduleWorkflowAction)
	require.True(t, ok)
	require.Equal(t, "schedule/tick/sch_01TEST", action.ID,
		"the base workflow id = the artifact id; Temporal appends the nominal fire time per fire")
	require.Equal(t, TickWorkflowType, action.Workflow)
	require.Equal(t, []interface{}{"sch_01TEST"}, action.Args,
		"exactly ONE argument — args are baked once and replayed verbatim per fire")
	require.Equal(t, "schedule_stigmer", action.TaskQueue)
	require.Equal(t, 24*time.Hour, action.WorkflowRunTimeout, "a backstop, not policy")
}

func TestCreateOptions_PausedStates(t *testing.T) {
	artifact := NewArtifact(LoadConfig())

	disabled := seedSchedule2(t, func(s *schedulev1.Schedule) { s.Spec.Enabled = false })
	require.True(t, artifact.CreateOptions(disabled).Paused,
		"the owner's switch pauses the artifact")

	paused := seedSchedule2(t, func(s *schedulev1.Schedule) {
		s.Status.PausedReason = "Paused after 5 consecutive failed runs."
	})
	require.True(t, artifact.CreateOptions(paused).Paused,
		"the platform's latch pauses the artifact")
}

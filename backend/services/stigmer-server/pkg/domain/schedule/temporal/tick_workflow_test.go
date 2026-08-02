package temporal

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

// The tick workflow's contract, pinned against the cloud twin: the
// revalidation short-circuit, the verdict matrix, the two tracking
// bounds, and the backoff shape. workflow.Sleep is time-skipped by the
// test environment, so even the bounded-cycles test runs instantly.

const testScheduleID = "sch_01TESTTICK"

// Stub signatures matching the production activities (context first, as
// registered implementations receive it).
func stubRecordTick(_ context.Context, _ string, _ string) (TickOutcome, error) {
	return TickFired, nil
}
func stubStartScheduledRun(_ context.Context, _ string, _ string) (*RunStart, error) {
	return nil, nil
}
func stubPollExecutionPhase(_ context.Context, _ string) (RunPhase, error) {
	return PhaseRunning, nil
}
func stubRecordSuccessfulRun(_ context.Context, _ string) error { return nil }
func stubRecordFailedRun(_ context.Context, _ string, _ string, _ FailureKind) (*FailureRecorded, error) {
	return &FailureRecorded{}, nil
}

func newTickEnv(t *testing.T) *testsuite.TestWorkflowEnvironment {
	t.Helper()
	s := testsuite.WorkflowTestSuite{}
	env := s.NewTestWorkflowEnvironment()
	env.RegisterWorkflowWithOptions((&TickWorkflow{}).Run,
		workflow.RegisterOptions{Name: TickWorkflowType})
	env.RegisterActivityWithOptions(stubRecordTick,
		activity.RegisterOptions{Name: RecordTickActivityName})
	env.RegisterActivityWithOptions(stubStartScheduledRun,
		activity.RegisterOptions{Name: StartScheduledRunActivityName})
	env.RegisterActivityWithOptions(stubPollExecutionPhase,
		activity.RegisterOptions{Name: PollExecutionPhaseActivityName})
	env.RegisterActivityWithOptions(stubRecordSuccessfulRun,
		activity.RegisterOptions{Name: RecordSuccessfulRunActivityName})
	env.RegisterActivityWithOptions(stubRecordFailedRun,
		activity.RegisterOptions{Name: RecordFailedRunActivityName})
	return env
}

func started(executionID string, budgetMinutes int) *RunStart {
	return &RunStart{Outcome: RunStarted, ExecutionID: executionID,
		TrackingTimeoutMinutes: budgetMinutes}
}

func TestTick_SkippedTickNeverStartsARun(t *testing.T) {
	for _, outcome := range []TickOutcome{TickSkippedDeleted, TickSkippedDisabled, TickSkippedAutoPaused} {
		t.Run(string(outcome), func(t *testing.T) {
			env := newTickEnv(t)
			env.OnActivity(RecordTickActivityName, mock.Anything, testScheduleID, mock.Anything).
				Return(outcome, nil)
			// No expectation on StartScheduledRun: an unexpected call fails the test.

			env.ExecuteWorkflow(TickWorkflowType, testScheduleID)

			require.True(t, env.IsWorkflowCompleted())
			require.NoError(t, env.GetWorkflowError(),
				"a skipped tick is a successful no-op — the revalidation is what makes orphaned artifacts harmless")
			env.AssertNotCalled(t, StartScheduledRunActivityName, mock.Anything, mock.Anything, mock.Anything)
		})
	}
}

func TestTick_FiredTickPassesTheSameNominalTimeToTheRunStart(t *testing.T) {
	// The nominal time is the fire's identity: last_fire_at records it
	// and the execution name derives from it — the two idempotency keys
	// must never disagree, so both activities must receive one value.
	env := newTickEnv(t)
	var recordedAt, startedAt string
	env.OnActivity(RecordTickActivityName, mock.Anything, testScheduleID, mock.Anything).
		Return(func(_ context.Context, _ string, nominal string) (TickOutcome, error) {
			recordedAt = nominal
			return TickFired, nil
		})
	env.OnActivity(StartScheduledRunActivityName, mock.Anything, testScheduleID, mock.Anything).
		Return(func(_ context.Context, _ string, nominal string) (*RunStart, error) {
			startedAt = nominal
			return &RunStart{Outcome: RunSkipped, TrackingTimeoutMinutes: 60}, nil
		})

	env.ExecuteWorkflow(TickWorkflowType, testScheduleID)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.NotEmpty(t, recordedAt)
	require.Equal(t, recordedAt, startedAt,
		"recordTick and startScheduledRun must see the SAME nominal fire time")
	parsed, err := time.Parse(time.RFC3339, recordedAt)
	require.NoError(t, err, "the nominal time crosses the activity boundary as RFC-3339")
	require.Zero(t, parsed.Nanosecond(), "nominal times are whole seconds — the workflow-id suffix granularity")
}

func TestTick_NominalTimeFromWorkflowIDSuffix(t *testing.T) {
	// Tier 2 of the derivation: Temporal appends the nominal time to the
	// artifact's base workflow id per fire. (Tier 1, the search
	// attribute, is not settable in the test framework — same limitation
	// the cloud twin records.)
	env := newTickEnv(t)
	env.SetStartWorkflowOptions(client.StartWorkflowOptions{
		ID: ArtifactID(testScheduleID) + "-2026-08-03T09:00:00Z",
	})
	var recordedAt string
	env.OnActivity(RecordTickActivityName, mock.Anything, testScheduleID, mock.Anything).
		Return(func(_ context.Context, _ string, nominal string) (TickOutcome, error) {
			recordedAt = nominal
			return TickSkippedDisabled, nil
		})

	env.ExecuteWorkflow(TickWorkflowType, testScheduleID)

	require.True(t, env.IsWorkflowCompleted())
	require.Equal(t, "2026-08-03T09:00:00Z", recordedAt,
		"the workflow-id suffix IS the nominal fire time")
}

func TestTick_CompletedRunResetsTheStreak(t *testing.T) {
	env := newTickEnv(t)
	env.OnActivity(RecordTickActivityName, mock.Anything, testScheduleID, mock.Anything).
		Return(TickFired, nil)
	env.OnActivity(StartScheduledRunActivityName, mock.Anything, testScheduleID, mock.Anything).
		Return(started("aex_01RUN", 60), nil)
	env.OnActivity(PollExecutionPhaseActivityName, mock.Anything, "aex_01RUN").
		Return(PhaseCompleted, nil)
	env.OnActivity(RecordSuccessfulRunActivityName, mock.Anything, testScheduleID).
		Return(nil)

	env.ExecuteWorkflow(TickWorkflowType, testScheduleID)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	env.AssertCalled(t, RecordSuccessfulRunActivityName, mock.Anything, testScheduleID)
	env.AssertNotCalled(t, RecordFailedRunActivityName,
		mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestTick_TerminalFailuresFeedTheStreakWithThePhaseNamed(t *testing.T) {
	cases := []struct {
		phase  RunPhase
		reason string
	}{
		{PhaseFailed, "run aex_01RUN ended failed"},
		{PhaseCancelled, "run aex_01RUN ended cancelled"},
		{PhaseTerminated, "run aex_01RUN ended terminated"},
	}
	for _, tc := range cases {
		t.Run(string(tc.phase), func(t *testing.T) {
			env := newTickEnv(t)
			env.OnActivity(RecordTickActivityName, mock.Anything, testScheduleID, mock.Anything).
				Return(TickFired, nil)
			env.OnActivity(StartScheduledRunActivityName, mock.Anything, testScheduleID, mock.Anything).
				Return(started("aex_01RUN", 60), nil)
			env.OnActivity(PollExecutionPhaseActivityName, mock.Anything, "aex_01RUN").
				Return(tc.phase, nil)
			var recordedReason string
			var recordedKind FailureKind
			env.OnActivity(RecordFailedRunActivityName, mock.Anything, testScheduleID, mock.Anything, mock.Anything).
				Return(func(_ context.Context, _ string, reason string, kind FailureKind) (*FailureRecorded, error) {
					recordedReason = reason
					recordedKind = kind
					return &FailureRecorded{ConsecutiveFailures: 1}, nil
				})

			env.ExecuteWorkflow(TickWorkflowType, testScheduleID)

			require.True(t, env.IsWorkflowCompleted())
			require.NoError(t, env.GetWorkflowError())
			require.Equal(t, tc.reason, recordedReason, "the verdict names the terminal phase")
			require.Equal(t, FailureRunFailed, recordedKind)
		})
	}
}

func TestTick_BudgetExhaustionRecordsATimeoutWithoutCancellingTheRun(t *testing.T) {
	env := newTickEnv(t)
	env.OnActivity(RecordTickActivityName, mock.Anything, testScheduleID, mock.Anything).
		Return(TickFired, nil)
	env.OnActivity(StartScheduledRunActivityName, mock.Anything, testScheduleID, mock.Anything).
		Return(started("aex_01HUNG", 1), nil) // one-minute budget
	env.OnActivity(PollExecutionPhaseActivityName, mock.Anything, "aex_01HUNG").
		Return(PhaseRunning, nil) // never terminal
	var recordedKind FailureKind
	env.OnActivity(RecordFailedRunActivityName, mock.Anything, testScheduleID, mock.Anything, mock.Anything).
		Return(func(_ context.Context, _ string, reason string, kind FailureKind) (*FailureRecorded, error) {
			recordedKind = kind
			require.Equal(t, "run aex_01HUNG did not finish within 1 minutes", reason)
			return &FailureRecorded{ConsecutiveFailures: 1}, nil
		})

	env.ExecuteWorkflow(TickWorkflowType, testScheduleID)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, FailureRunTimedOut, recordedKind)
}

func TestTick_TrackingIsBoundedByMaxCycles(t *testing.T) {
	// A misconfigured budget must not outlive the code-level backstop:
	// with an absurd budget and a never-terminal run, the loop exits
	// after at most MaxTrackingCycles polls and records a timeout —
	// the MaxRecoveryCycles convention: one test proves the loop works,
	// this one proves it terminates.
	env := newTickEnv(t)
	env.OnActivity(RecordTickActivityName, mock.Anything, testScheduleID, mock.Anything).
		Return(TickFired, nil)
	env.OnActivity(StartScheduledRunActivityName, mock.Anything, testScheduleID, mock.Anything).
		Return(started("aex_01FOREVER", 1_000_000), nil)
	pollCount := 0
	env.OnActivity(PollExecutionPhaseActivityName, mock.Anything, "aex_01FOREVER").
		Return(func(_ context.Context, _ string) (RunPhase, error) {
			pollCount++
			return PhaseRunning, nil
		})
	env.OnActivity(RecordFailedRunActivityName, mock.Anything, testScheduleID, mock.Anything, mock.Anything).
		Return(&FailureRecorded{ConsecutiveFailures: 1}, nil)

	env.ExecuteWorkflow(TickWorkflowType, testScheduleID)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, MaxTrackingCycles, pollCount,
		"the loop polls exactly MaxTrackingCycles times before giving up")
}

func TestTick_GoneRunRecordsNoVerdict(t *testing.T) {
	// Deleting a run must not brick its schedule: no reset, no strike.
	env := newTickEnv(t)
	env.OnActivity(RecordTickActivityName, mock.Anything, testScheduleID, mock.Anything).
		Return(TickFired, nil)
	env.OnActivity(StartScheduledRunActivityName, mock.Anything, testScheduleID, mock.Anything).
		Return(started("aex_01DELETED", 60), nil)
	env.OnActivity(PollExecutionPhaseActivityName, mock.Anything, "aex_01DELETED").
		Return(PhaseGone, nil)

	env.ExecuteWorkflow(TickWorkflowType, testScheduleID)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	env.AssertNotCalled(t, RecordSuccessfulRunActivityName, mock.Anything, mock.Anything)
	env.AssertNotCalled(t, RecordFailedRunActivityName,
		mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestTick_StartFailuresFeedTheStreakWithoutTracking(t *testing.T) {
	cases := []struct {
		name    string
		outcome RunOutcome
		reason  string
	}{
		{"target missing", RunTargetMissing, "target agent acme/fee-bot not found"},
		{"refused", RunRefused, "run refused: insufficient credits"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env := newTickEnv(t)
			env.OnActivity(RecordTickActivityName, mock.Anything, testScheduleID, mock.Anything).
				Return(TickFired, nil)
			env.OnActivity(StartScheduledRunActivityName, mock.Anything, testScheduleID, mock.Anything).
				Return(&RunStart{Outcome: tc.outcome, TrackingTimeoutMinutes: 60,
					FailureReason: tc.reason}, nil)
			var recordedReason string
			var recordedKind FailureKind
			env.OnActivity(RecordFailedRunActivityName, mock.Anything, testScheduleID, mock.Anything, mock.Anything).
				Return(func(_ context.Context, _ string, reason string, kind FailureKind) (*FailureRecorded, error) {
					recordedReason = reason
					recordedKind = kind
					return &FailureRecorded{ConsecutiveFailures: 1}, nil
				})

			env.ExecuteWorkflow(TickWorkflowType, testScheduleID)

			require.True(t, env.IsWorkflowCompleted())
			require.NoError(t, env.GetWorkflowError())
			require.Equal(t, tc.reason, recordedReason,
				"the start-failure copy flows into the streak verbatim")
			require.Equal(t, FailureStartFailed, recordedKind)
			env.AssertNotCalled(t, PollExecutionPhaseActivityName, mock.Anything, mock.Anything)
		})
	}
}

func TestTick_SkippedRunStartEndsTheTick(t *testing.T) {
	env := newTickEnv(t)
	env.OnActivity(RecordTickActivityName, mock.Anything, testScheduleID, mock.Anything).
		Return(TickFired, nil)
	env.OnActivity(StartScheduledRunActivityName, mock.Anything, testScheduleID, mock.Anything).
		Return(&RunStart{Outcome: RunSkipped, TrackingTimeoutMinutes: 60}, nil)

	env.ExecuteWorkflow(TickWorkflowType, testScheduleID)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	env.AssertNotCalled(t, PollExecutionPhaseActivityName, mock.Anything, mock.Anything)
	env.AssertNotCalled(t, RecordFailedRunActivityName,
		mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestTrackingBackoff_LinearTimesFiveCappedAtSixty(t *testing.T) {
	// recoveryBackoff's exact shape — the only backoff curve the
	// platform runs in production workflow code. Cap reached by cycle
	// twelve, bounding poll volume on long runs.
	require.Equal(t, 5*time.Second, trackingBackoff(1))
	require.Equal(t, 25*time.Second, trackingBackoff(5))
	require.Equal(t, 60*time.Second, trackingBackoff(12))
	require.Equal(t, 60*time.Second, trackingBackoff(240))
}

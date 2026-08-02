package temporal

import (
	"fmt"
	"strings"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// MaxTrackingCycles is the tracking loop's code-level backstop, on top of
// the per-fire budget: 240 polls at the capped backoff is ~3.9 hours and
// ~1,200 history events — the loop can never outgrow a workflow history
// even if a budget is misconfigured. Package-level so the bound test can
// assert it (the MaxRecoveryCycles convention).
const MaxTrackingCycles = 240

// scheduledStartTimeKey reads the nominal fire time Temporal stamps on
// every schedule-started workflow — tier one of the nominal-time
// derivation (present on cron fires AND manual triggers alike).
var scheduledStartTimeKey = temporal.NewSearchAttributeKeyTime("TemporalScheduledStartTime")

// TickWorkflow is one schedule fire, spanning its run (DD-013 via
// DD-015): record the fire, start the run, poll it to a terminal phase,
// record the verdict. Spanning is what makes the artifact's overlap SKIP
// genuinely mean "never start a run while the last is active", and the
// verdict is what feeds the failure streak behind the platform
// auto-pause.
//
// WHY A TIMER-DRIVEN POLL AND NOT THE CALLBACK TOKEN — read before
// "fixing" this. OSS already uses async activity completion for
// call:agent, so the token is the tempting shape here too. It loses on
// grounds that are edition-neutral (DD-015 D-E): the token cannot be
// re-armed after a create-then-crash, and its completion fire is
// best-effort — two silent-hang modes on a surface where a hang is a
// silenced reminder. The poll holds no worker thread (the workflow is
// dormant between polls; each poll is a millisecond activity), is
// bounded twice (budget + MaxTrackingCycles), and keeps ONE verdict
// matrix across both editions. The boundary rule stands: if you can hand
// your task token to the thing you are waiting on AND a hang is
// tolerable, use the token; a schedule fire satisfies neither.
//
// FORWARD CONSTRAINT: ticks live for minutes-to-an-hour once tracking is
// real, and OSS releases cut every 1-3 days — an in-flight tick WILL
// straddle a binary upgrade. Any behavioral change to this workflow body
// must be gated with workflow.GetVersion, and the replay gate
// (ci.replay.yaml + tick_replay_test.go) must stay green against the
// committed histories.
type TickWorkflow struct{}

// Run executes one tick. The single argument is the schedule resource id
// (Temporal bakes action args once — the nominal fire time is derived,
// never carried).
func (w *TickWorkflow) Run(ctx workflow.Context, scheduleResourceID string) error {
	logger := workflow.GetLogger(ctx)
	nominalFireTime := nominalFireTime(ctx, scheduleResourceID)
	nominalRFC3339 := nominalFireTime.UTC().Format(time.RFC3339)

	// Record stub: short idempotent status writes, retried freely.
	recordCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts:    3,
			InitialInterval:    5 * time.Second,
			BackoffCoefficient: 2.0,
		},
	})
	// Run-start stub: enters the full create pipeline (session, context,
	// workflow start) — minutes-scale timeout, still retried (the
	// deterministic execution name absorbs retries).
	startCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 3 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts:    3,
			InitialInterval:    5 * time.Second,
			BackoffCoefficient: 2.0,
		},
	})
	// Failure-record stub: EXACTLY ONE attempt — the streak increment is
	// the clock's single non-idempotent write. A retry after a successful
	// write over-counts and pauses a healthy schedule early; a lost write
	// under-counts, which fails safe.
	failureCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 1},
	})

	var tickOutcome TickOutcome
	if err := workflow.ExecuteActivity(recordCtx, RecordTickActivityName,
		scheduleResourceID, nominalRFC3339).Get(ctx, &tickOutcome); err != nil {
		return fmt.Errorf("record tick: %w", err)
	}
	if tickOutcome != TickFired {
		logger.Info("Schedule tick complete",
			"schedule_id", scheduleResourceID, "nominal_fire_time", nominalRFC3339,
			"outcome", string(tickOutcome))
		return nil
	}

	var runStart RunStart
	if err := workflow.ExecuteActivity(startCtx, StartScheduledRunActivityName,
		scheduleResourceID, nominalRFC3339).Get(ctx, &runStart); err != nil {
		return fmt.Errorf("start scheduled run: %w", err)
	}

	switch runStart.Outcome {
	case RunSkipped:
		logger.Info("Schedule tick complete", "schedule_id", scheduleResourceID,
			"nominal_fire_time", nominalRFC3339, "run_outcome", string(runStart.Outcome))
		return nil
	case RunTargetMissing, RunRefused:
		// The run never existed: the streak counts the fire, the
		// completion verdicts do not.
		var recorded FailureRecorded
		if err := workflow.ExecuteActivity(failureCtx, RecordFailedRunActivityName,
			scheduleResourceID, runStart.FailureReason, FailureStartFailed).Get(ctx, &recorded); err != nil {
			return fmt.Errorf("record start failure: %w", err)
		}
		logger.Info("Schedule tick complete", "schedule_id", scheduleResourceID,
			"nominal_fire_time", nominalRFC3339, "run_outcome", string(runStart.Outcome),
			"verdict", "start_failed", "consecutive_failures", recorded.ConsecutiveFailures,
			"paused", recorded.Paused)
		return nil
	case RunStarted, RunAlreadyStarted:
		return w.trackRun(ctx, recordCtx, failureCtx, scheduleResourceID, nominalRFC3339, runStart)
	default:
		return fmt.Errorf("unknown run outcome %q", runStart.Outcome)
	}
}

// trackRun polls the run to a terminal phase within this fire's budget
// and records the verdict.
func (w *TickWorkflow) trackRun(
	ctx workflow.Context,
	recordCtx workflow.Context,
	failureCtx workflow.Context,
	scheduleResourceID string,
	nominalRFC3339 string,
	runStart RunStart,
) error {
	logger := workflow.GetLogger(ctx)
	deadline := workflow.Now(ctx).Add(time.Duration(runStart.TrackingTimeoutMinutes) * time.Minute)

	phase := PhaseRunning
	budgetExhausted := false
	// Poll-first, deadline checked after each poll and before each sleep:
	// an ALREADY_STARTED retry may already be terminal, and the loop must
	// never sleep past its own deadline.
	for cycle := 1; ; cycle++ {
		if cycle > MaxTrackingCycles {
			budgetExhausted = true
			break
		}
		if err := workflow.ExecuteActivity(recordCtx, PollExecutionPhaseActivityName,
			runStart.ExecutionID).Get(ctx, &phase); err != nil {
			// DB unreachable past the activity's own retries: fail the
			// tick with NO verdict — guessing "failed" during an outage
			// could pause a healthy schedule. The artifact stays armed
			// (PauseOnFailure=false); the next fire is unaffected.
			return fmt.Errorf("poll execution phase: %w", err)
		}
		if phase != PhaseRunning {
			break
		}
		if !workflow.Now(ctx).Before(deadline) {
			budgetExhausted = true
			break
		}
		if err := workflow.Sleep(ctx, trackingBackoff(cycle)); err != nil {
			return err
		}
	}

	switch {
	case budgetExhausted:
		// The run is NOT cancelled: its own execution profile bounds
		// spend, and a destructive act buys nothing. Under SKIP this
		// budget is literally the maximum time one hung run may silence
		// the schedule.
		reason := fmt.Sprintf("run %s did not finish within %d minutes",
			runStart.ExecutionID, runStart.TrackingTimeoutMinutes)
		var recorded FailureRecorded
		if err := workflow.ExecuteActivity(failureCtx, RecordFailedRunActivityName,
			scheduleResourceID, reason, FailureRunTimedOut).Get(ctx, &recorded); err != nil {
			return fmt.Errorf("record tracking timeout: %w", err)
		}
		logVerdict(logger, scheduleResourceID, nominalRFC3339, runStart, "timed_out", &recorded)
	case phase == PhaseCompleted:
		if err := workflow.ExecuteActivity(recordCtx, RecordSuccessfulRunActivityName,
			scheduleResourceID).Get(ctx, nil); err != nil {
			return fmt.Errorf("record successful run: %w", err)
		}
		logVerdict(logger, scheduleResourceID, nominalRFC3339, runStart, "completed", nil)
	case phase == PhaseGone:
		// Deleting a run must not brick its schedule: no verdict.
		logVerdict(logger, scheduleResourceID, nominalRFC3339, runStart, "gone", nil)
	default: // FAILED, CANCELLED, TERMINATED
		reason := fmt.Sprintf("run %s ended %s", runStart.ExecutionID, strings.ToLower(string(phase)))
		var recorded FailureRecorded
		if err := workflow.ExecuteActivity(failureCtx, RecordFailedRunActivityName,
			scheduleResourceID, reason, FailureRunFailed).Get(ctx, &recorded); err != nil {
			return fmt.Errorf("record failed run: %w", err)
		}
		logVerdict(logger, scheduleResourceID, nominalRFC3339, runStart,
			strings.ToLower(string(phase)), &recorded)
	}
	return nil
}

// trackingBackoff is the delay before the next phase poll: linear
// cycle×5s capped at 60s — recoveryBackoff's exact shape, the only
// backoff curve this platform runs in production workflow code. It
// notices a 30-120s run (the common case) within seconds and reaches its
// cap by cycle twelve, bounding poll volume on long runs.
func trackingBackoff(cycle int) time.Duration {
	d := time.Duration(cycle) * 5 * time.Second
	if d > 60*time.Second {
		return 60 * time.Second
	}
	return d
}

// nominalFireTime derives THE fire's nominal time, three tiers:
//  1. The TemporalScheduledStartTime search attribute (cron fires and
//     manual triggers both carry it — spike-verified).
//  2. The workflow-id suffix Temporal appends to the artifact's base id.
//  3. Workflow time truncated to whole seconds (a hand-started tick).
//
// The nominal time is the fire's identity: last_fire_at records it and
// the execution name derives from it, so both idempotency keys agree on
// every retry.
func nominalFireTime(ctx workflow.Context, scheduleResourceID string) time.Time {
	if t, ok := workflow.GetTypedSearchAttributes(ctx).GetTime(scheduledStartTimeKey); ok {
		return t
	}
	base := ArtifactID(scheduleResourceID) + "-"
	workflowID := workflow.GetInfo(ctx).WorkflowExecution.ID
	if strings.HasPrefix(workflowID, base) {
		if t, err := time.Parse(time.RFC3339, strings.TrimPrefix(workflowID, base)); err == nil {
			return t
		}
	}
	return workflow.Now(ctx).Truncate(time.Second)
}

func logVerdict(logger interface {
	Info(msg string, keyvals ...interface{})
}, scheduleResourceID, nominalRFC3339 string, runStart RunStart, verdict string, recorded *FailureRecorded) {
	if recorded == nil {
		logger.Info("Schedule tick complete",
			"schedule_id", scheduleResourceID, "nominal_fire_time", nominalRFC3339,
			"run_outcome", string(runStart.Outcome), "execution_id", runStart.ExecutionID,
			"verdict", verdict)
		return
	}
	logger.Info("Schedule tick complete",
		"schedule_id", scheduleResourceID, "nominal_fire_time", nominalRFC3339,
		"run_outcome", string(runStart.Outcome), "execution_id", runStart.ExecutionID,
		"verdict", verdict, "consecutive_failures", recorded.ConsecutiveFailures,
		"paused", recorded.Paused)
}

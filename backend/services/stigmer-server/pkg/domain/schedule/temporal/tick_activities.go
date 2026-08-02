package temporal

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// The tick's outcome vocabulary. String-typed so Temporal's JSON data
// converter serializes them stably across releases; the VALUES mirror the
// cloud edition's enums name-for-name (one runbook, two editions).
type (
	// TickOutcome is recordTick's verdict on whether this fire proceeds.
	TickOutcome string
	// RunOutcome is startScheduledRun's verdict on the run start.
	RunOutcome string
	// RunPhase is the tracked execution's observed phase class.
	RunPhase string
	// FailureKind labels which path fed the streak, for the log line.
	FailureKind string
)

const (
	TickFired             TickOutcome = "FIRED"
	TickSkippedDeleted    TickOutcome = "SKIPPED_DELETED"
	TickSkippedDisabled   TickOutcome = "SKIPPED_DISABLED"
	TickSkippedAutoPaused TickOutcome = "SKIPPED_AUTO_PAUSED"

	RunStarted        RunOutcome = "STARTED"
	RunAlreadyStarted RunOutcome = "ALREADY_STARTED"
	RunSkipped        RunOutcome = "SKIPPED"
	RunTargetMissing  RunOutcome = "TARGET_MISSING"
	RunRefused        RunOutcome = "REFUSED"

	PhaseRunning    RunPhase = "RUNNING"
	PhaseCompleted  RunPhase = "COMPLETED"
	PhaseFailed     RunPhase = "FAILED"
	PhaseCancelled  RunPhase = "CANCELLED"
	PhaseTerminated RunPhase = "TERMINATED"
	PhaseGone       RunPhase = "GONE"

	FailureStartFailed FailureKind = "START_FAILED"
	FailureRunFailed   FailureKind = "RUN_FAILED"
	FailureRunTimedOut FailureKind = "RUN_TIMED_OUT"
)

// RunStart is startScheduledRun's full answer. The tracking budget rides
// the activity RESULT so workflow timing derives from recorded history —
// a config flip can never confuse an in-flight replay.
type RunStart struct {
	Outcome RunOutcome `json:"outcome"`
	// ExecutionID is set exactly when Outcome ∈ {STARTED, ALREADY_STARTED}.
	ExecutionID string `json:"executionId"`
	// TrackingTimeoutMinutes is this fire's tracking budget, already clamped.
	TrackingTimeoutMinutes int `json:"trackingTimeoutMinutes"`
	// FailureReason carries the deterministic start-failure copy when
	// Outcome ∈ {TARGET_MISSING, REFUSED}.
	FailureReason string `json:"failureReason"`
}

// FailureRecorded is recordFailedRun's post-image summary.
type FailureRecorded struct {
	ConsecutiveFailures int  `json:"consecutiveFailures"`
	Paused              bool `json:"paused"`
}

// Activity name constants — slash-namespaced like the platform's other
// Go-owned system activities, and registered under these exact names.
const (
	RecordTickActivityName        = "stigmer/schedule/record-tick"
	StartScheduledRunActivityName = "stigmer/schedule/start-run"
	PollExecutionPhaseActivityName = "stigmer/schedule/poll-phase"
	RecordSuccessfulRunActivityName = "stigmer/schedule/record-success"
	RecordFailedRunActivityName    = "stigmer/schedule/record-failure"
)

// TickActivities is the tick workflow's activity surface. Nominal fire
// times cross the boundary as RFC-3339 UTC strings so the payload never
// depends on the data converter's time handling — the same wire shape the
// cloud tick uses.
type TickActivities struct {
	store      store.Store
	config     *Config
	syncer     *Syncer
	runStarter *RunStarter
}

// NewTickActivities wires the activity implementations.
func NewTickActivities(st store.Store, config *Config, syncer *Syncer, runStarter *RunStarter) *TickActivities {
	return &TickActivities{store: st, config: config, syncer: syncer, runStarter: runStarter}
}

// RecordTick re-reads the schedule row and either records the fire or
// explains why this tick is a no-op — the revalidation that makes every
// orphaned artifact harmless by construction (DD-008 D2): deleted,
// owner-disabled, and platform-paused rows all decline the fire.
func (a *TickActivities) RecordTick(ctx context.Context, scheduleResourceID string, nominalFireTimeRFC3339 string) (TickOutcome, error) {
	schedule := &schedulev1.Schedule{}
	err := a.store.GetResource(ctx, apiresourcekind.ApiResourceKind_schedule, scheduleResourceID, schedule)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			log.Info().Str("schedule_id", scheduleResourceID).
				Msg("Schedule tick no-op — row deleted (orphaned artifact; the reconciliation pass removes it)")
			return TickSkippedDeleted, nil
		}
		return "", fmt.Errorf("load schedule %s: %w", scheduleResourceID, err)
	}
	if !schedule.GetSpec().GetEnabled() {
		log.Info().Str("schedule_id", scheduleResourceID).Msg("Schedule tick no-op — owner-disabled")
		return TickSkippedDisabled, nil
	}
	if reason := schedule.GetStatus().GetPausedReason(); reason != "" {
		log.Info().Str("schedule_id", scheduleResourceID).Str("reason", reason).
			Msg("Schedule tick no-op — platform-paused")
		return TickSkippedAutoPaused, nil
	}

	if err := a.recordFire(ctx, schedule, nominalFireTimeRFC3339); err != nil {
		return "", err
	}
	return TickFired, nil
}

// recordFire stamps the fire on status: last_fire_at = the NOMINAL time
// (identical on activity retry — idempotent by construction), plus a
// best-effort next_fire_at refresh from the live artifact. The refresh
// failing must never block recording the fire that already happened.
func (a *TickActivities) recordFire(ctx context.Context, schedule *schedulev1.Schedule, nominalFireTimeRFC3339 string) error {
	nominal, err := time.Parse(time.RFC3339, nominalFireTimeRFC3339)
	if err != nil {
		return fmt.Errorf("parse nominal fire time %q: %w", nominalFireTimeRFC3339, err)
	}

	nextFireAt, peekErr := a.syncer.PeekNextFireAt(ctx, schedule)
	if peekErr != nil {
		log.Warn().Err(peekErr).Str("schedule_id", schedule.GetMetadata().GetId()).
			Msg("Could not refresh next_fire_at during tick (recording the fire without it)")
	}

	updated := &schedulev1.Schedule{}
	err = a.store.UpdateResource(ctx, apiresourcekind.ApiResourceKind_schedule,
		schedule.GetMetadata().GetId(), updated, func() error {
			status := ensureStatus(updated)
			status.LastFireAt = timestamppb.New(nominal)
			if peekErr == nil {
				if nextFireAt == nil {
					status.NextFireAt = nil
				} else {
					status.NextFireAt = timestamppb.New(*nextFireAt)
				}
			}
			bumpStatusAudit(status, time.Now())
			return nil
		})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			// Deleted between revalidation and the write: nothing to record.
			return nil
		}
		return fmt.Errorf("record schedule fire on status: %w", err)
	}
	log.Info().Str("schedule_id", schedule.GetMetadata().GetId()).
		Str("nominal_fire_time", nominalFireTimeRFC3339).Msg("Schedule fire recorded")
	return nil
}

// StartScheduledRun re-validates and starts this fire's run. The
// revalidation repeats recordTick's checks collapsed into one SKIPPED
// outcome — the row may have changed between the two activities, and a
// fire that recorded must still decline to run against a row that no
// longer wants it.
func (a *TickActivities) StartScheduledRun(ctx context.Context, scheduleResourceID string, nominalFireTimeRFC3339 string) (*RunStart, error) {
	trackingBudget := a.config.ResolvedRunTrackingTimeoutMinutes()

	schedule := &schedulev1.Schedule{}
	err := a.store.GetResource(ctx, apiresourcekind.ApiResourceKind_schedule, scheduleResourceID, schedule)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return nil, fmt.Errorf("load schedule %s: %w", scheduleResourceID, err)
	}
	if errors.Is(err, store.ErrNotFound) || !schedule.GetSpec().GetEnabled() ||
		schedule.GetStatus().GetPausedReason() != "" {
		log.Info().Str("schedule_id", scheduleResourceID).
			Msg("Schedule run start no-op — row deleted/disabled/paused between record and start")
		return &RunStart{Outcome: RunSkipped, TrackingTimeoutMinutes: trackingBudget}, nil
	}

	nominal, err := time.Parse(time.RFC3339, nominalFireTimeRFC3339)
	if err != nil {
		return nil, fmt.Errorf("parse nominal fire time %q: %w", nominalFireTimeRFC3339, err)
	}

	outcome, err := a.runStarter.StartRun(ctx, schedule, nominal)
	if err != nil {
		// Infrastructure failure: the activity retries, and the
		// deterministic execution name absorbs the retry.
		return nil, err
	}

	result := &RunStart{TrackingTimeoutMinutes: trackingBudget}
	switch o := outcome.(type) {
	case RunStartedOutcome:
		if o.AlreadyExisted {
			result.Outcome = RunAlreadyStarted
		} else {
			result.Outcome = RunStarted
		}
		result.ExecutionID = o.ExecutionID
		log.Info().Str("schedule_id", scheduleResourceID).
			Str("execution_id", o.ExecutionID).Bool("already_existed", o.AlreadyExisted).
			Msg("Schedule fire started its run")
	case RunTargetMissingOutcome:
		result.Outcome = RunTargetMissing
		result.FailureReason = o.Reason
	case RunRefusedOutcome:
		result.Outcome = RunRefused
		result.FailureReason = "run refused: " + o.Reason
	default:
		return nil, fmt.Errorf("unknown run outcome %T", outcome)
	}
	return result, nil
}

// PollExecutionPhase classifies the tracked run's current phase from one
// row read. GONE (row deleted mid-track) is distinct from RUNNING: a
// deleted run must not brick its schedule, so it yields no verdict.
//
// The read unmarshals the whole execution row — SQLite stores one
// protobuf blob with no projection (DD-015 D-E). At one poll per 5-60s
// per active run on a single-user daemon that is noise; a projected
// phase column is the named follow-up if it ever isn't.
func (a *TickActivities) PollExecutionPhase(ctx context.Context, executionID string) (RunPhase, error) {
	execution := &agentexecutionv1.AgentExecution{}
	err := a.store.GetResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, executionID, execution)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return PhaseGone, nil
		}
		return "", fmt.Errorf("load execution %s: %w", executionID, err)
	}

	switch execution.GetStatus().GetPhase() {
	case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		return PhaseCompleted, nil
	case agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		return PhaseCancelled, nil
	case agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED:
		return PhaseTerminated, nil
	case agentexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		return PhaseFailed, nil
	default:
		// PENDING, IN_PROGRESS, WAITING_FOR_APPROVAL, PAUSED, and any
		// future non-terminal phase: still running.
		return PhaseRunning, nil
	}
}

// RecordSuccessfulRun resets the failure streak to its absorbing zero.
// Idempotent — the caller retries freely: a LOST reset strands a stale
// streak that pauses a healthy schedule later, so this write must land.
func (a *TickActivities) RecordSuccessfulRun(ctx context.Context, scheduleResourceID string) error {
	updated := &schedulev1.Schedule{}
	err := a.store.UpdateResource(ctx, apiresourcekind.ApiResourceKind_schedule,
		scheduleResourceID, updated, func() error {
			status := ensureStatus(updated)
			status.ConsecutiveFailures = 0
			bumpStatusAudit(status, time.Now())
			return nil
		})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil // deleted mid-track: nothing to reset
		}
		return fmt.Errorf("reset failure streak on schedule %s: %w", scheduleResourceID, err)
	}
	log.Info().Str("schedule_id", scheduleResourceID).
		Msg("Schedule run completed — failure streak reset")
	return nil
}

// RecordFailedRun increments the failure streak and, exactly at the
// threshold crossing, latches the platform pause. The whole verdict is
// ONE UpdateResource closure on the freshly-read row — the OSS shape of
// the cloud's single guarded SQL statement (DD-015 D-C): the increment
// reads the live value inside the lock, the pause is written only at the
// crossing and only when no reason is already latched (the first pause's
// copy is never rewritten), and next_fire_at clears so the schedule
// advertises no fire it will decline.
//
// The caller gives this activity EXACTLY ONE attempt: an increment is not
// idempotent — a retry after a successful write over-counts and pauses a
// healthy schedule early, while a lost write under-counts and fails safe.
func (a *TickActivities) RecordFailedRun(ctx context.Context, scheduleResourceID string, reason string, kind FailureKind) (*FailureRecorded, error) {
	threshold := a.config.ResolvedMaxConsecutiveFailures()
	pausedReason := fmt.Sprintf(
		"Paused after %d consecutive failed runs. Last failure: %s", threshold, reason)

	var recorded FailureRecorded
	var crossedThreshold bool
	updated := &schedulev1.Schedule{}
	err := a.store.UpdateResource(ctx, apiresourcekind.ApiResourceKind_schedule,
		scheduleResourceID, updated, func() error {
			status := ensureStatus(updated)
			status.ConsecutiveFailures++
			if int(status.ConsecutiveFailures) >= threshold && status.PausedReason == "" {
				status.PausedReason = pausedReason
				crossedThreshold = true
			}
			if int(status.ConsecutiveFailures) >= threshold {
				status.NextFireAt = nil
			}
			bumpStatusAudit(status, time.Now())
			recorded = FailureRecorded{
				ConsecutiveFailures: int(status.ConsecutiveFailures),
				Paused:              status.PausedReason != "",
			}
			return nil
		})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			// Deleted mid-track: a no-op by construction — deleting a run
			// or its schedule must never resurrect either.
			log.Info().Str("schedule_id", scheduleResourceID).Str("reason", reason).
				Msg("Schedule run failure not recorded — row deleted mid-track")
			return &FailureRecorded{}, nil
		}
		return nil, fmt.Errorf("record failed run on schedule %s: %w", scheduleResourceID, err)
	}

	log.Warn().Str("failure_kind", string(kind)).Str("schedule_id", scheduleResourceID).
		Int("consecutive_failures", recorded.ConsecutiveFailures).Int("threshold", threshold).
		Bool("paused", recorded.Paused).Str("reason", reason).
		Msg("Schedule run failed")

	if crossedThreshold {
		// Best-effort immediate artifact re-sync so the pause reaches
		// Temporal now; the reconciliation pass is the correctness path.
		schedule := &schedulev1.Schedule{}
		if getErr := a.store.GetResource(ctx, apiresourcekind.ApiResourceKind_schedule,
			scheduleResourceID, schedule); getErr == nil {
			if _, syncErr := a.syncer.EnsureAndRecord(ctx, schedule); syncErr != nil {
				log.Error().Err(syncErr).Str("schedule_id", scheduleResourceID).
					Msg("Paused schedule's artifact not yet converged (the reconciliation pass will pause it)")
			}
		}
	}
	return &recorded, nil
}

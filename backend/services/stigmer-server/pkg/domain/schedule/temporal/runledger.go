package temporal

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// The fire ledger (project DD-017 D-7): every fire leaves a row —
// including fires that created no execution, which are the only durable
// trace of a refused launch gate below the auto-pause threshold.
//
// Writes ride INSIDE the existing activities, never the tick workflow
// body: activity implementations are invisible to recorded histories, so
// the ledger needs no workflow.GetVersion gate and cannot disturb the
// replay contract (tick_workflow.go's FORWARD CONSTRAINT).
//
// Every write is BEST-EFFORT with a loud log line. The alternatives are
// both worse: failing the start activity on a bookkeeping error would
// retry a run that already achieved its outcome, and failing a verdict
// activity would error the tick before the streak write lands — a
// storage hiccup must never break streak semantics. The ledger upsert
// converges under the retries that do happen (fire-identity key,
// terminal rows immutable).

// Ledger vocabulary: the lowercase names of the
// ai.stigmer.agentic.schedule.v1.ScheduleRunOutcome / ScheduleRunOrigin
// enum values, shared byte-for-byte with the cloud edition's rows.
const (
	runLedgerOriginCron   = "cron"
	runLedgerOriginManual = "manual"

	runLedgerOutcomeStarted       = "started"
	runLedgerOutcomeRefused       = "refused"
	runLedgerOutcomeTargetMissing = "target_missing"
	runLedgerOutcomeSkipped       = "skipped"
	runLedgerOutcomeCompleted     = "completed"
	runLedgerOutcomeFailed        = "failed"
	runLedgerOutcomeTimedOut      = "timed_out"
)

// recordRunLedgerStart writes the fire's row from the run-start outcome.
// Start failures (refused / target missing) and skips are terminal at
// insert — no tracking follows them, so the reason must survive NOW.
// ALREADY_STARTED collapses into "started": the row is the same fire,
// re-found by an idempotent retry.
func recordRunLedgerStart(
	ctx context.Context,
	st store.Store,
	scheduleID string,
	org string,
	nominalFireTimeRFC3339 string,
	origin string,
	runStart *RunStart,
) {
	record := &store.ScheduleRunRecord{
		ScheduleID:      scheduleID,
		Org:             org,
		NominalFireTime: nominalFireTimeRFC3339,
		Origin:          origin,
		ExecutionID:     runStart.ExecutionID,
		Reason:          runStart.FailureReason,
	}
	switch runStart.Outcome {
	case RunStarted, RunAlreadyStarted:
		record.Outcome = runLedgerOutcomeStarted
	case RunRefused:
		record.Outcome = runLedgerOutcomeRefused
		record.CompletedAt = time.Now().UTC().Format(time.RFC3339)
	case RunTargetMissing:
		record.Outcome = runLedgerOutcomeTargetMissing
		record.CompletedAt = time.Now().UTC().Format(time.RFC3339)
	case RunSkipped:
		record.Outcome = runLedgerOutcomeSkipped
		record.CompletedAt = time.Now().UTC().Format(time.RFC3339)
	default:
		return
	}
	if err := st.UpsertScheduleRun(ctx, record); err != nil {
		log.Warn().Err(err).Str("schedule_id", scheduleID).
			Str("nominal_fire_time", nominalFireTimeRFC3339).Str("outcome", record.Outcome).
			Msg("Fire-ledger row not written (best-effort — the run itself is unaffected)")
	}
}

// recordRunLedgerVerdict stamps the terminal verdict on the schedule's
// in-flight CRON row. Keyed on (schedule, cron) by necessity: the
// verdict activities' signatures are pinned by recorded Temporal
// histories, and the artifact's SKIP overlap plus the spanning tick
// guarantee at most one in-flight cron run per schedule. The origin
// filter keeps a newer manual fire's untracked row from stealing the
// verdict.
func recordRunLedgerVerdict(ctx context.Context, st store.Store, scheduleID, outcome, reason string) {
	completedAt := time.Now().UTC().Format(time.RFC3339)
	if err := st.MarkLatestScheduleRunTerminal(ctx, scheduleID, runLedgerOriginCron,
		outcome, reason, completedAt); err != nil {
		log.Warn().Err(err).Str("schedule_id", scheduleID).Str("outcome", outcome).
			Msg("Fire-ledger verdict not written (best-effort — the streak write is unaffected)")
	}
}

// RecordManualFire writes the fire-ledger row for one trigger-command
// fire (origin=manual) — exported for the trigger controller, so the
// ledger vocabulary and the outcome mapping stay in ONE package. Manual
// rows for started runs stay non-terminal forever in storage: manual
// fires are untracked by design (the caller watches the execution), and
// listRuns resolves their outcome from the execution's live phase at
// read time. Start failures are terminal at insert, exactly like cron.
func RecordManualFire(
	ctx context.Context,
	st store.Store,
	scheduleID string,
	org string,
	nominalFireTimeRFC3339 string,
	outcome RunOutcomeResult,
) {
	runStart := &RunStart{}
	switch o := outcome.(type) {
	case RunStartedOutcome:
		runStart.Outcome = RunStarted
		runStart.ExecutionID = o.ExecutionID
	case RunTargetMissingOutcome:
		runStart.Outcome = RunTargetMissing
		runStart.FailureReason = o.Reason
	case RunRefusedOutcome:
		runStart.Outcome = RunRefused
		runStart.FailureReason = "run refused: " + o.Reason
	default:
		return
	}
	recordRunLedgerStart(ctx, st, scheduleID, org, nominalFireTimeRFC3339,
		runLedgerOriginManual, runStart)
}

// pruneRunLedger enforces the retention the table was born with; called
// from the reconciliation pass (the clock's one periodic hook).
func pruneRunLedger(ctx context.Context, st store.Store, retentionDays int) {
	cutoff := time.Now().UTC().AddDate(0, 0, -retentionDays).Format(time.RFC3339)
	pruned, err := st.PruneScheduleRuns(ctx, cutoff)
	if err != nil {
		log.Warn().Err(err).Str("cutoff", cutoff).
			Msg("Fire-ledger retention prune failed (retried next pass)")
		return
	}
	if pruned > 0 {
		log.Info().Int64("pruned", pruned).Str("cutoff", cutoff).
			Msg("Fire-ledger retention prune complete")
	}
}

/**
 * The fire ledger — ports pkg/domain/schedule/temporal/runledger.go
 * (DD-017 D-7): every fire leaves a row — including fires that created no
 * execution, which are the only durable trace of a refused launch gate
 * below the auto-pause threshold.
 *
 * Writes ride INSIDE the existing activities, never the tick workflow
 * body: activity implementations are invisible to recorded histories, so
 * the ledger needs no version gate and cannot disturb the replay contract
 * (workflows/tick.ts's FORWARD CONSTRAINT).
 *
 * Every write is BEST-EFFORT with a loud log line. The alternatives are
 * both worse: failing the start activity on a bookkeeping error would
 * retry a run that already achieved its outcome, and failing a verdict
 * activity would error the tick before the streak write lands — a storage
 * hiccup must never break streak semantics. The ledger upsert converges
 * under the retries that do happen (fire-identity key, terminal rows
 * immutable).
 */
import type { Logger } from "../../boot/logger.js";
import type { ScheduleRunRecord, Store } from "../../store/interface.js";
import type { RunOutcomeResult } from "./run-starter.js";
import {
  RUN_ALREADY_STARTED,
  RUN_REFUSED,
  RUN_SKIPPED,
  RUN_STARTED,
  RUN_TARGET_MISSING,
  type RunStart,
} from "./names.js";

// Ledger vocabulary: the lowercase names of the
// ai.stigmer.agentic.schedule.v1.ScheduleRunOutcome / ScheduleRunOrigin
// enum values, shared byte-for-byte with the cloud edition's rows.
export const RUN_LEDGER_ORIGIN_CRON = "cron";
export const RUN_LEDGER_ORIGIN_MANUAL = "manual";

export const RUN_LEDGER_OUTCOME_STARTED = "started";
export const RUN_LEDGER_OUTCOME_REFUSED = "refused";
export const RUN_LEDGER_OUTCOME_TARGET_MISSING = "target_missing";
export const RUN_LEDGER_OUTCOME_SKIPPED = "skipped";
export const RUN_LEDGER_OUTCOME_COMPLETED = "completed";
export const RUN_LEDGER_OUTCOME_FAILED = "failed";
export const RUN_LEDGER_OUTCOME_TIMED_OUT = "timed_out";

/** Go time.RFC3339 with whole seconds — the ledger's house time format. */
export function rfc3339Seconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Writes the fire's row from the run-start outcome (Go
 * recordRunLedgerStart). Start failures (refused / target missing) and
 * skips are terminal at insert — no tracking follows them, so the reason
 * must survive NOW. ALREADY_STARTED collapses into "started": the row is
 * the same fire, re-found by an idempotent retry.
 */
export async function recordRunLedgerStart(
  store: Store,
  logger: Logger,
  scheduleId: string,
  org: string,
  nominalFireTimeRfc3339: string,
  origin: string,
  runStart: RunStart,
): Promise<void> {
  const base = {
    scheduleId,
    org,
    nominalFireTime: nominalFireTimeRfc3339,
    origin,
    executionId: runStart.executionId,
    reason: runStart.failureReason,
    recordedAt: "",
  };
  let record: ScheduleRunRecord;
  switch (runStart.outcome) {
    case RUN_STARTED:
    case RUN_ALREADY_STARTED:
      record = { ...base, outcome: RUN_LEDGER_OUTCOME_STARTED, completedAt: "" };
      break;
    case RUN_REFUSED:
      record = {
        ...base,
        outcome: RUN_LEDGER_OUTCOME_REFUSED,
        completedAt: rfc3339Seconds(new Date()),
      };
      break;
    case RUN_TARGET_MISSING:
      record = {
        ...base,
        outcome: RUN_LEDGER_OUTCOME_TARGET_MISSING,
        completedAt: rfc3339Seconds(new Date()),
      };
      break;
    case RUN_SKIPPED:
      record = {
        ...base,
        outcome: RUN_LEDGER_OUTCOME_SKIPPED,
        completedAt: rfc3339Seconds(new Date()),
      };
      break;
    default:
      return;
  }
  try {
    await store.upsertScheduleRun(record);
  } catch (error) {
    logger.warn(
      "Fire-ledger row not written (best-effort — the run itself is unaffected)",
      {
        schedule_id: scheduleId,
        nominal_fire_time: nominalFireTimeRfc3339,
        outcome: record.outcome,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/**
 * Stamps the terminal verdict on the schedule's in-flight CRON row (Go
 * recordRunLedgerVerdict). Keyed on (schedule, cron) by necessity: the
 * verdict activities' signatures are pinned by recorded Temporal
 * histories, and the artifact's SKIP overlap plus the spanning tick
 * guarantee at most one in-flight cron run per schedule. The origin filter
 * keeps a newer manual fire's untracked row from stealing the verdict.
 */
export async function recordRunLedgerVerdict(
  store: Store,
  logger: Logger,
  scheduleId: string,
  outcome: string,
  reason: string,
): Promise<void> {
  try {
    await store.markLatestScheduleRunTerminal(
      scheduleId,
      RUN_LEDGER_ORIGIN_CRON,
      outcome,
      reason,
      rfc3339Seconds(new Date()),
    );
  } catch (error) {
    logger.warn(
      "Fire-ledger verdict not written (best-effort — the streak write is unaffected)",
      {
        schedule_id: scheduleId,
        outcome,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/**
 * Writes the fire-ledger row for one trigger-command fire (origin=manual)
 * — exported for the trigger controller, so the ledger vocabulary and the
 * outcome mapping stay in ONE module (Go RecordManualFire). Manual rows
 * for started runs stay non-terminal forever in storage: manual fires are
 * untracked by design (the caller watches the execution), and listRuns
 * resolves their outcome from the execution's live phase at read time.
 * Start failures are terminal at insert, exactly like cron.
 */
export async function recordManualFire(
  store: Store,
  logger: Logger,
  scheduleId: string,
  org: string,
  nominalFireTimeRfc3339: string,
  outcome: RunOutcomeResult,
): Promise<void> {
  const runStart: RunStart = {
    outcome: RUN_STARTED,
    executionId: "",
    trackingTimeoutMinutes: 0,
    failureReason: "",
  };
  switch (outcome.kind) {
    case "started":
      runStart.outcome = RUN_STARTED;
      runStart.executionId = outcome.executionId;
      break;
    case "targetMissing":
      runStart.outcome = RUN_TARGET_MISSING;
      runStart.failureReason = outcome.reason;
      break;
    case "refused":
      runStart.outcome = RUN_REFUSED;
      runStart.failureReason = `run refused: ${outcome.reason}`;
      break;
    default: {
      const exhaustive: never = outcome;
      throw new Error(`unknown run outcome ${String(exhaustive)}`);
    }
  }
  await recordRunLedgerStart(
    store,
    logger,
    scheduleId,
    org,
    nominalFireTimeRfc3339,
    RUN_LEDGER_ORIGIN_MANUAL,
    runStart,
  );
}

/**
 * Enforces the retention the table was born with; called from the
 * reconciliation pass (the clock's one periodic hook). Go pruneRunLedger.
 */
export async function pruneRunLedger(
  store: Store,
  logger: Logger,
  retentionDays: number,
): Promise<void> {
  const cutoff = rfc3339Seconds(
    new Date(Date.now() - retentionDays * 24 * 3_600_000),
  );
  let pruned: number;
  try {
    pruned = await store.pruneScheduleRuns(cutoff);
  } catch (error) {
    logger.warn("Fire-ledger retention prune failed (retried next pass)", {
      cutoff,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  if (pruned > 0) {
    logger.info("Fire-ledger retention prune complete", { pruned, cutoff });
  }
}

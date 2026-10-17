/**
 * The fire ledger: every fire leaves a row — including fires that created
 * no run, which are the only durable trace of a refused launch gate below
 * the auto-pause threshold — keyed by the fire's id, and naming who fired
 * it when someone did.
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
 * under the retries that do happen (the fire id is the key, terminal rows
 * immutable).
 */
import type { ApiResourceAuditActor } from "@stigmer/apis/ai/stigmer/commons/apiresource/status_pb";

import type { Logger } from "../../boot/logger.js";
import type { RoutineFireRecord, Store } from "../../store/interface.js";
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
// ai.stigmer.agentic.routine.v1.RoutineFireOutcome / RoutineFireOrigin
// enum values, shared byte-for-byte with the cloud edition's rows.
export const RUN_LEDGER_ORIGIN_SCHEDULE = "schedule";
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

/** Which fire a ledger write is about. */
export interface LedgerFire {
  readonly routineId: string;
  /** The fire's id: its run's name (run-starter.ts). */
  readonly fireId: string;
  readonly org: string;
  /** RFC-3339, whole seconds. */
  readonly nominalFireTime: string;
  /** RUN_LEDGER_ORIGIN_SCHEDULE or RUN_LEDGER_ORIGIN_MANUAL. */
  readonly origin: string;
  /** Who fired it; absent for a schedule's own fire. */
  readonly firedBy?: ApiResourceAuditActor;
}

/**
 * Writes the fire's row from the run-start outcome. Start failures
 * (refused / target missing) and skips are terminal at insert — no
 * tracking follows them, so the reason must survive NOW. ALREADY_STARTED
 * collapses into "started": the row is the same fire, re-found by an
 * idempotent retry.
 */
export async function recordRunLedgerStart(
  store: Store,
  logger: Logger,
  fire: LedgerFire,
  runStart: RunStart,
): Promise<void> {
  const base = {
    routineId: fire.routineId,
    fireId: fire.fireId,
    org: fire.org,
    nominalFireTime: fire.nominalFireTime,
    origin: fire.origin,
    runId: runStart.executionId,
    firedBy: fire.firedBy,
    reason: runStart.failureReason,
    recordedAt: "",
  };
  let record: RoutineFireRecord;
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
    await store.upsertRoutineFire(record);
  } catch (error) {
    logger.warn(
      "Fire-ledger row not written (best-effort — the run itself is unaffected)",
      {
        routine_id: fire.routineId,
        fire_id: fire.fireId,
        outcome: record.outcome,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/**
 * Stamps the terminal verdict on the routine's in-flight SCHEDULE row.
 * Keyed on (routine, schedule origin) by necessity: the verdict
 * activities' signatures are pinned by recorded Temporal histories, and
 * the artifact's SKIP overlap plus the spanning tick guarantee at most one
 * in-flight schedule run per routine. The origin filter keeps a newer
 * manual fire's untracked row from stealing the verdict.
 */
export async function recordRunLedgerVerdict(
  store: Store,
  logger: Logger,
  routineId: string,
  outcome: string,
  reason: string,
): Promise<void> {
  try {
    await store.markLatestRoutineFireTerminal(
      routineId,
      RUN_LEDGER_ORIGIN_SCHEDULE,
      outcome,
      reason,
      rfc3339Seconds(new Date()),
    );
  } catch (error) {
    logger.warn(
      "Fire-ledger verdict not written (best-effort — the streak write is unaffected)",
      {
        routine_id: routineId,
        outcome,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/**
 * Writes the fire-ledger row for one fire call (origin=manual) — exported
 * for the fire step, so the ledger vocabulary and the outcome mapping stay
 * in ONE module. Manual rows for started runs stay non-terminal forever in
 * storage: manual fires are untracked by design (the caller watches the
 * run), and listFires resolves their outcome from the run's live phase at
 * read time. Start failures are terminal at insert, exactly like a
 * schedule's.
 */
export async function recordManualFire(
  store: Store,
  logger: Logger,
  fire: Omit<LedgerFire, "origin">,
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
      runStart.executionId = outcome.runId;
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
    { ...fire, origin: RUN_LEDGER_ORIGIN_MANUAL },
    runStart,
  );
}

/**
 * Enforces the retention the table was born with; called from the
 * reconciliation pass (the clock's one periodic hook).
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
    pruned = await store.pruneRoutineFires(cutoff);
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

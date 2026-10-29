/**
 * The tick workflow's activity surface. Nominal fire times cross the
 * boundary as RFC-3339 UTC strings so the payload never depends on the
 * data converter's time handling — the same wire shape in every edition.
 *
 * Registered by the schedule worker under the pinned slash names
 * (names.ts); the retry postures live with the CALLER (workflows/tick.ts's
 * three activity-option contexts), most critically record-failure's
 * single attempt — the streak increment is the clock's one non-idempotent
 * write.
 */
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { bumpStatusAudit } from "../../pipeline/steps/defaults.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { RoutineTemporalConfig } from "./config.js";
import {
  FAILURE_RUN_FAILED,
  FAILURE_RUN_TIMED_OUT,
  FAILURE_START_FAILED,
  PHASE_CANCELLED,
  PHASE_COMPLETED,
  PHASE_FAILED,
  PHASE_GONE,
  PHASE_RUNNING,
  PHASE_TERMINATED,
  RECORD_FAILED_RUN_ACTIVITY_NAME,
  RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME,
  RECORD_TICK_ACTIVITY_NAME,
  POLL_EXECUTION_PHASE_ACTIVITY_NAME,
  RUN_ALREADY_STARTED,
  RUN_REFUSED,
  RUN_SKIPPED,
  RUN_STARTED,
  RUN_TARGET_MISSING,
  START_SCHEDULED_RUN_ACTIVITY_NAME,
  TICK_FIRED,
  TICK_SKIPPED_AUTO_PAUSED,
  TICK_SKIPPED_DELETED,
  TICK_SKIPPED_DISABLED,
  TICK_SKIPPED_UNSCHEDULED,
  type FailureKind,
  type FailureRecorded,
  type ObservedRunPhase,
  type RunStart,
  type RoutineTickActivities,
  type TickOutcome,
} from "./names.js";
import {
  RUN_LEDGER_ORIGIN_SCHEDULE,
  RUN_LEDGER_OUTCOME_COMPLETED,
  RUN_LEDGER_OUTCOME_FAILED,
  RUN_LEDGER_OUTCOME_TIMED_OUT,
  recordRunLedgerStart,
  recordRunLedgerVerdict,
} from "./run-ledger.js";
import { hasSchedule } from "./artifact.js";
import { scheduleFire } from "./run-starter.js";
import type { RunStarter } from "./run-starter.js";
import type { RoutineSyncer } from "./syncer.js";
import { ensureStatus } from "./status-writes.js";

export interface RoutineTickActivityDeps {
  readonly store: Store;
  readonly config: RoutineTemporalConfig;
  /**
   * The narrow syncer slice the activities call (satisfied by
   * RoutineSyncer): the next-fire refresh on record-tick and the
   * best-effort artifact re-sync at the pause-threshold crossing.
   */
  readonly syncer: Pick<RoutineSyncer, "peekNextFireAt" | "ensureAndRecord">;
  /** The fire edge (satisfied by RunStarter). */
  readonly runStarter: Pick<RunStarter, "startRun">;
  readonly logger: Logger;
}

/** Wires the activity implementations. */
export function createRoutineTickActivities(
  deps: RoutineTickActivityDeps,
): RoutineTickActivities {
  return {
    [RECORD_TICK_ACTIVITY_NAME]: (routineResourceId, nominalFireTimeRfc3339) =>
      recordTick(deps, routineResourceId, nominalFireTimeRfc3339),
    [START_SCHEDULED_RUN_ACTIVITY_NAME]: (
      routineResourceId,
      nominalFireTimeRfc3339,
    ) => startScheduledRun(deps, routineResourceId, nominalFireTimeRfc3339),
    [POLL_EXECUTION_PHASE_ACTIVITY_NAME]: (executionId) =>
      pollExecutionPhase(deps, executionId),
    [RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME]: (routineResourceId) =>
      recordSuccessfulRun(deps, routineResourceId),
    [RECORD_FAILED_RUN_ACTIVITY_NAME]: (routineResourceId, reason, kind) =>
      recordFailedRun(deps, routineResourceId, reason, kind),
  };
}

/**
 * Re-reads the routine row and either records the fire or explains why
 * this tick is a no-op — the revalidation that makes every orphaned
 * artifact harmless by construction: deleted, owner-disabled,
 * and platform-paused rows all decline the fire.
 */
async function recordTick(
  deps: RoutineTickActivityDeps,
  routineResourceId: string,
  nominalFireTimeRfc3339: string,
): Promise<TickOutcome> {
  let routine: Routine;
  try {
    routine = await deps.store.getResource(
      ApiResourceKind.routine,
      routineResourceId,
      RoutineSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      deps.logger.info(
        "Routine tick no-op — row deleted (orphaned artifact; the reconciliation pass removes it)",
        { routine_id: routineResourceId },
      );
      return TICK_SKIPPED_DELETED;
    }
    throw new Error(`load routine ${routineResourceId}: ${message(error)}`, {
      cause: error,
    });
  }
  if (!(routine.spec?.enabled ?? false)) {
    deps.logger.info("Routine tick no-op — owner-disabled", {
      routine_id: routineResourceId,
    });
    return TICK_SKIPPED_DISABLED;
  }
  if (!hasSchedule(routine)) {
    deps.logger.info(
      "Routine tick no-op — the routine has no schedule (its stale artifact is removed by the reconciliation pass)",
      { routine_id: routineResourceId },
    );
    return TICK_SKIPPED_UNSCHEDULED;
  }
  const pausedReason = routine.status?.pausedReason ?? "";
  if (pausedReason !== "") {
    deps.logger.info("Routine tick no-op — platform-paused", {
      routine_id: routineResourceId,
      reason: pausedReason,
    });
    return TICK_SKIPPED_AUTO_PAUSED;
  }

  await recordFire(deps, routine, nominalFireTimeRfc3339);
  return TICK_FIRED;
}

/**
 * Stamps the fire on status: last_fire_at = the NOMINAL time (identical on
 * activity retry — idempotent by construction), plus a best-effort
 * next_fire_at refresh from the live artifact. The refresh failing must
 * never block recording the fire that already happened.
 */
async function recordFire(
  deps: RoutineTickActivityDeps,
  routine: Routine,
  nominalFireTimeRfc3339: string,
): Promise<void> {
  const nominal = parseRfc3339(nominalFireTimeRfc3339);

  let nextFireAt: Date | undefined;
  let peekFailed = false;
  try {
    nextFireAt = await deps.syncer.peekNextFireAt(routine);
  } catch (error) {
    peekFailed = true;
    deps.logger.warn(
      "Could not refresh next_fire_at during tick (recording the fire without it)",
      {
        routine_id: routine.metadata?.id ?? "",
        error: message(error),
      },
    );
  }

  try {
    await deps.store.updateResource(
      ApiResourceKind.routine,
      routine.metadata?.id ?? "",
      RoutineSchema,
      (live) => {
        const status = ensureStatus(live);
        status.lastFireAt = timestampFromDate(nominal);
        if (!peekFailed) {
          status.nextFireAt =
            nextFireAt === undefined ? undefined : timestampFromDate(nextFireAt);
        }
        bumpStatusAudit(status);
      },
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      // Deleted between revalidation and the write: nothing to record.
      return;
    }
    throw new Error(`record routine fire on status: ${message(error)}`, {
      cause: error,
    });
  }
  deps.logger.info("Routine fire recorded", {
    routine_id: routine.metadata?.id ?? "",
    nominal_fire_time: nominalFireTimeRfc3339,
  });
}

/**
 * Re-validates and starts this fire's run. The revalidation repeats
 * recordTick's checks collapsed into one SKIPPED outcome — the row may
 * have changed between the two activities, and a fire that recorded must
 * still decline to run against a row that no longer wants it.
 */
async function startScheduledRun(
  deps: RoutineTickActivityDeps,
  routineResourceId: string,
  nominalFireTimeRfc3339: string,
): Promise<RunStart> {
  const trackingBudget = deps.config.resolvedRunTrackingTimeoutMinutes();

  let routine: Routine | undefined;
  try {
    routine = await deps.store.getResource(
      ApiResourceKind.routine,
      routineResourceId,
      RoutineSchema,
    );
  } catch (error) {
    if (!(error instanceof ResourceNotFoundError)) {
      throw new Error(
        `load routine ${routineResourceId}: ${message(error)}`,
        { cause: error },
      );
    }
    routine = undefined;
  }
  if (
    routine === undefined ||
    !(routine.spec?.enabled ?? false) ||
    !hasSchedule(routine) ||
    (routine.status?.pausedReason ?? "") !== ""
  ) {
    deps.logger.info(
      "Routine run start no-op — row deleted/disabled/paused between record and start",
      { routine_id: routineResourceId },
    );
    const skipped: RunStart = {
      outcome: RUN_SKIPPED,
      executionId: "",
      trackingTimeoutMinutes: trackingBudget,
      failureReason: "",
    };
    // The deleted-row skip deliberately leaves NO ledger row: the delete
    // already cascaded the routine's history, and a bookkeeping write here
    // would resurrect it.
    if (routine !== undefined) {
      await recordRunLedgerStart(
        deps.store,
        deps.logger,
        {
          routineId: routineResourceId,
          fireId: scheduleFire(routineResourceId, parseRfc3339(nominalFireTimeRfc3339)).fireId,
          org: routine.metadata?.org ?? "",
          nominalFireTime: nominalFireTimeRfc3339,
          origin: RUN_LEDGER_ORIGIN_SCHEDULE,
        },
        skipped,
      );
    }
    return skipped;
  }

  const fire = scheduleFire(routineResourceId, parseRfc3339(nominalFireTimeRfc3339));

  // Infrastructure failures throw: the activity retries, and the
  // deterministic run name absorbs the retry.
  const outcome = await deps.runStarter.startRun(routine, fire);

  const result: RunStart = {
    outcome: RUN_STARTED,
    executionId: "",
    trackingTimeoutMinutes: trackingBudget,
    failureReason: "",
  };
  switch (outcome.kind) {
    case "started":
      result.outcome = outcome.alreadyExisted ? RUN_ALREADY_STARTED : RUN_STARTED;
      result.executionId = outcome.runId;
      deps.logger.info("Routine's schedule fire started its run", {
        routine_id: routineResourceId,
        run_id: outcome.runId,
        already_existed: outcome.alreadyExisted,
      });
      break;
    case "targetMissing":
      result.outcome = RUN_TARGET_MISSING;
      result.failureReason = outcome.reason;
      break;
    case "refused":
      result.outcome = RUN_REFUSED;
      result.failureReason = `run refused: ${outcome.reason}`;
      break;
    default: {
      const exhaustive: never = outcome;
      throw new Error(`unknown run outcome ${String(exhaustive)}`);
    }
  }
  // The fire ledger: start failures are terminal at insert —
  // the refusal reason must survive NOW, not at the pause threshold.
  await recordRunLedgerStart(
    deps.store,
    deps.logger,
    {
      routineId: routineResourceId,
      fireId: fire.fireId,
      org: routine.metadata?.org ?? "",
      nominalFireTime: nominalFireTimeRfc3339,
      origin: RUN_LEDGER_ORIGIN_SCHEDULE,
    },
    result,
  );
  return result;
}

/**
 * Classifies the tracked run's current phase from one row read. GONE (row
 * deleted mid-track) is distinct from RUNNING: a deleted run must not
 * brick its routine, so it yields no verdict.
 *
 * The read unmarshals the whole execution row — SQLite stores one protobuf
 * blob with no projection. At one poll per 5-60s per active
 * run on a single-user daemon that is noise; a projected phase column is
 * the named follow-up if it ever isn't.
 */
async function pollExecutionPhase(
  deps: RoutineTickActivityDeps,
  executionId: string,
): Promise<ObservedRunPhase> {
  let phase: RunPhase;
  try {
    const execution = await deps.store.getResource(
      ApiResourceKind.run,
      executionId,
      RunSchema,
    );
    phase = execution.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return PHASE_GONE;
    }
    throw new Error(`load execution ${executionId}: ${message(error)}`, {
      cause: error,
    });
  }

  switch (phase) {
    case RunPhase.RUN_COMPLETED:
      return PHASE_COMPLETED;
    case RunPhase.RUN_CANCELLED:
      return PHASE_CANCELLED;
    case RunPhase.RUN_TERMINATED:
      return PHASE_TERMINATED;
    case RunPhase.RUN_FAILED:
      return PHASE_FAILED;
    default:
      // PENDING, IN_PROGRESS, WAITING_FOR_APPROVAL, PAUSED, and any future
      // non-terminal phase: still running.
      return PHASE_RUNNING;
  }
}

/**
 * Resets the failure streak to its absorbing zero. Idempotent — the caller
 * retries freely: a LOST reset strands a stale streak that pauses a
 * healthy routine later, so this write must land.
 */
async function recordSuccessfulRun(
  deps: RoutineTickActivityDeps,
  routineResourceId: string,
): Promise<void> {
  try {
    await deps.store.updateResource(
      ApiResourceKind.routine,
      routineResourceId,
      RoutineSchema,
      (live) => {
        const status = ensureStatus(live);
        status.consecutiveFailures = 0;
        bumpStatusAudit(status);
      },
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return; // deleted mid-track: nothing to reset
    }
    throw new Error(
      `reset failure streak on routine ${routineResourceId}: ${message(error)}`,
      { cause: error },
    );
  }
  await recordRunLedgerVerdict(
    deps.store,
    deps.logger,
    routineResourceId,
    RUN_LEDGER_OUTCOME_COMPLETED,
    "",
  );
  deps.logger.info("Routine run completed — failure streak reset", {
    routine_id: routineResourceId,
  });
}

/**
 * Increments the failure streak and, exactly at the threshold crossing,
 * latches the platform pause. The whole verdict is ONE updateResource
 * closure on the freshly-read row — the OSS shape of the cloud's single
 * guarded SQL statement: the increment reads the live value
 * inside the lock, the pause is written only at the crossing and only when
 * no reason is already latched (the first pause's copy is never
 * rewritten), and next_fire_at clears so the routine advertises no fire
 * it will decline.
 *
 * The caller gives this activity EXACTLY ONE attempt: an increment is not
 * idempotent — a retry after a successful write over-counts and pauses a
 * healthy routine early, while a lost write under-counts and fails safe.
 */
async function recordFailedRun(
  deps: RoutineTickActivityDeps,
  routineResourceId: string,
  reason: string,
  kind: FailureKind,
): Promise<FailureRecorded> {
  const threshold = deps.config.resolvedMaxConsecutiveFailures();
  const pausedReason = `Paused after ${threshold} consecutive failed runs. Last failure: ${reason}`;

  let recorded: FailureRecorded = { consecutiveFailures: 0, paused: false };
  let crossedThreshold = false;
  try {
    await deps.store.updateResource(
      ApiResourceKind.routine,
      routineResourceId,
      RoutineSchema,
      (live) => {
        const status = ensureStatus(live);
        status.consecutiveFailures++;
        if (status.consecutiveFailures >= threshold && status.pausedReason === "") {
          status.pausedReason = pausedReason;
          crossedThreshold = true;
        }
        if (status.consecutiveFailures >= threshold) {
          status.nextFireAt = undefined;
        }
        bumpStatusAudit(status);
        recorded = {
          consecutiveFailures: status.consecutiveFailures,
          paused: status.pausedReason !== "",
        };
      },
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      // Deleted mid-track: a no-op by construction — deleting a run or its
      // routine must never resurrect either.
      deps.logger.info(
        "Routine run failure not recorded — row deleted mid-track",
        { routine_id: routineResourceId, reason },
      );
      return { consecutiveFailures: 0, paused: false };
    }
    throw new Error(
      `record failed run on routine ${routineResourceId}: ${message(error)}`,
      { cause: error },
    );
  }

  deps.logger.warn("Routine run failed", {
    failure_kind: kind,
    routine_id: routineResourceId,
    consecutive_failures: recorded.consecutiveFailures,
    threshold,
    paused: recorded.paused,
    reason,
  });

  // The fire ledger's terminal verdict. START_FAILED rows were already
  // written terminal by the start activity — only tracked-run verdicts
  // mark here.
  switch (kind) {
    case FAILURE_RUN_FAILED:
      await recordRunLedgerVerdict(
        deps.store,
        deps.logger,
        routineResourceId,
        RUN_LEDGER_OUTCOME_FAILED,
        reason,
      );
      break;
    case FAILURE_RUN_TIMED_OUT:
      await recordRunLedgerVerdict(
        deps.store,
        deps.logger,
        routineResourceId,
        RUN_LEDGER_OUTCOME_TIMED_OUT,
        reason,
      );
      break;
    case FAILURE_START_FAILED:
      // Terminal at insert (recordRunLedgerStart) — nothing to mark.
      break;
    default: {
      const exhaustive: never = kind;
      throw new Error(`unknown failure kind ${String(exhaustive)}`);
    }
  }

  if (crossedThreshold) {
    // Best-effort immediate artifact re-sync so the pause reaches Temporal
    // now; the reconciliation pass is the correctness path.
    try {
      const routine = await deps.store.getResource(
        ApiResourceKind.routine,
        routineResourceId,
        RoutineSchema,
      );
      await deps.syncer.ensureAndRecord(routine);
    } catch (error) {
      deps.logger.error(
        "Paused routine's artifact not yet converged (the reconciliation pass will pause it)",
        { routine_id: routineResourceId, error: message(error) },
      );
    }
  }
  return recorded;
}

/** Strict RFC 3339 parse — an unparseable nominal time fails the activity. */
function parseRfc3339(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`parse nominal fire time "${value}": invalid RFC-3339`);
  }
  return parsed;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The tick workflow's activity surface — ports
 * pkg/domain/schedule/temporal/tick_activities.go. Nominal fire times
 * cross the boundary as RFC-3339 UTC strings so the payload never depends
 * on the data converter's time handling — the same wire shape the cloud
 * tick uses.
 *
 * Registered by the schedule worker under the pinned slash names
 * (names.ts); the retry postures live with the CALLER (workflows/tick.ts's
 * three activity-option contexts), most critically record-failure's
 * single attempt — the streak increment is the clock's one non-idempotent
 * write.
 */
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { ScheduleTemporalConfig } from "./config.js";
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
  type FailureKind,
  type FailureRecorded,
  type RunPhase,
  type RunStart,
  type ScheduleTickActivities,
  type TickOutcome,
} from "./names.js";
import {
  RUN_LEDGER_ORIGIN_CRON,
  RUN_LEDGER_OUTCOME_COMPLETED,
  RUN_LEDGER_OUTCOME_FAILED,
  RUN_LEDGER_OUTCOME_TIMED_OUT,
  recordRunLedgerStart,
  recordRunLedgerVerdict,
} from "./run-ledger.js";
import type { RunStarter } from "./run-starter.js";
import type { ScheduleSyncer } from "./syncer.js";
import { bumpStatusAudit, ensureStatus } from "./status-writes.js";

export interface ScheduleTickActivityDeps {
  readonly store: Store;
  readonly config: ScheduleTemporalConfig;
  /**
   * The narrow syncer slice the activities call (satisfied by
   * ScheduleSyncer): the next-fire refresh on record-tick and the
   * best-effort artifact re-sync at the pause-threshold crossing.
   */
  readonly syncer: Pick<ScheduleSyncer, "peekNextFireAt" | "ensureAndRecord">;
  /** The fire edge (satisfied by RunStarter). */
  readonly runStarter: Pick<RunStarter, "startRun">;
  readonly logger: Logger;
}

/** Wires the activity implementations (Go NewTickActivities). */
export function createScheduleTickActivities(
  deps: ScheduleTickActivityDeps,
): ScheduleTickActivities {
  return {
    [RECORD_TICK_ACTIVITY_NAME]: (scheduleResourceId, nominalFireTimeRfc3339) =>
      recordTick(deps, scheduleResourceId, nominalFireTimeRfc3339),
    [START_SCHEDULED_RUN_ACTIVITY_NAME]: (
      scheduleResourceId,
      nominalFireTimeRfc3339,
    ) => startScheduledRun(deps, scheduleResourceId, nominalFireTimeRfc3339),
    [POLL_EXECUTION_PHASE_ACTIVITY_NAME]: (executionId) =>
      pollExecutionPhase(deps, executionId),
    [RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME]: (scheduleResourceId) =>
      recordSuccessfulRun(deps, scheduleResourceId),
    [RECORD_FAILED_RUN_ACTIVITY_NAME]: (scheduleResourceId, reason, kind) =>
      recordFailedRun(deps, scheduleResourceId, reason, kind),
  };
}

/**
 * Re-reads the schedule row and either records the fire or explains why
 * this tick is a no-op — the revalidation that makes every orphaned
 * artifact harmless by construction (DD-008 D2): deleted, owner-disabled,
 * and platform-paused rows all decline the fire (Go RecordTick).
 */
async function recordTick(
  deps: ScheduleTickActivityDeps,
  scheduleResourceId: string,
  nominalFireTimeRfc3339: string,
): Promise<TickOutcome> {
  let schedule: Schedule;
  try {
    schedule = await deps.store.getResource(
      ApiResourceKind.schedule,
      scheduleResourceId,
      ScheduleSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      deps.logger.info(
        "Schedule tick no-op — row deleted (orphaned artifact; the reconciliation pass removes it)",
        { schedule_id: scheduleResourceId },
      );
      return TICK_SKIPPED_DELETED;
    }
    throw new Error(`load schedule ${scheduleResourceId}: ${message(error)}`, {
      cause: error,
    });
  }
  if (!(schedule.spec?.enabled ?? false)) {
    deps.logger.info("Schedule tick no-op — owner-disabled", {
      schedule_id: scheduleResourceId,
    });
    return TICK_SKIPPED_DISABLED;
  }
  const pausedReason = schedule.status?.pausedReason ?? "";
  if (pausedReason !== "") {
    deps.logger.info("Schedule tick no-op — platform-paused", {
      schedule_id: scheduleResourceId,
      reason: pausedReason,
    });
    return TICK_SKIPPED_AUTO_PAUSED;
  }

  await recordFire(deps, schedule, nominalFireTimeRfc3339);
  return TICK_FIRED;
}

/**
 * Stamps the fire on status: last_fire_at = the NOMINAL time (identical on
 * activity retry — idempotent by construction), plus a best-effort
 * next_fire_at refresh from the live artifact. The refresh failing must
 * never block recording the fire that already happened (Go recordFire).
 */
async function recordFire(
  deps: ScheduleTickActivityDeps,
  schedule: Schedule,
  nominalFireTimeRfc3339: string,
): Promise<void> {
  const nominal = parseRfc3339(nominalFireTimeRfc3339);

  let nextFireAt: Date | undefined;
  let peekFailed = false;
  try {
    nextFireAt = await deps.syncer.peekNextFireAt(schedule);
  } catch (error) {
    peekFailed = true;
    deps.logger.warn(
      "Could not refresh next_fire_at during tick (recording the fire without it)",
      {
        schedule_id: schedule.metadata?.id ?? "",
        error: message(error),
      },
    );
  }

  try {
    await deps.store.updateResource(
      ApiResourceKind.schedule,
      schedule.metadata?.id ?? "",
      ScheduleSchema,
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
    throw new Error(`record schedule fire on status: ${message(error)}`, {
      cause: error,
    });
  }
  deps.logger.info("Schedule fire recorded", {
    schedule_id: schedule.metadata?.id ?? "",
    nominal_fire_time: nominalFireTimeRfc3339,
  });
}

/**
 * Re-validates and starts this fire's run. The revalidation repeats
 * recordTick's checks collapsed into one SKIPPED outcome — the row may
 * have changed between the two activities, and a fire that recorded must
 * still decline to run against a row that no longer wants it (Go
 * StartScheduledRun).
 */
async function startScheduledRun(
  deps: ScheduleTickActivityDeps,
  scheduleResourceId: string,
  nominalFireTimeRfc3339: string,
): Promise<RunStart> {
  const trackingBudget = deps.config.resolvedRunTrackingTimeoutMinutes();

  let schedule: Schedule | undefined;
  try {
    schedule = await deps.store.getResource(
      ApiResourceKind.schedule,
      scheduleResourceId,
      ScheduleSchema,
    );
  } catch (error) {
    if (!(error instanceof ResourceNotFoundError)) {
      throw new Error(
        `load schedule ${scheduleResourceId}: ${message(error)}`,
        { cause: error },
      );
    }
    schedule = undefined;
  }
  if (
    schedule === undefined ||
    !(schedule.spec?.enabled ?? false) ||
    (schedule.status?.pausedReason ?? "") !== ""
  ) {
    deps.logger.info(
      "Schedule run start no-op — row deleted/disabled/paused between record and start",
      { schedule_id: scheduleResourceId },
    );
    const skipped: RunStart = {
      outcome: RUN_SKIPPED,
      executionId: "",
      trackingTimeoutMinutes: trackingBudget,
      failureReason: "",
    };
    // The deleted-row skip deliberately leaves NO ledger row: the delete
    // already cascaded the schedule's history, and a bookkeeping write here
    // would resurrect it.
    if (schedule !== undefined) {
      await recordRunLedgerStart(
        deps.store,
        deps.logger,
        scheduleResourceId,
        schedule.metadata?.org ?? "",
        nominalFireTimeRfc3339,
        RUN_LEDGER_ORIGIN_CRON,
        skipped,
      );
    }
    return skipped;
  }

  const nominal = parseRfc3339(nominalFireTimeRfc3339);

  // Infrastructure failures throw: the activity retries, and the
  // deterministic execution name absorbs the retry.
  const outcome = await deps.runStarter.startRun(schedule, nominal);

  const result: RunStart = {
    outcome: RUN_STARTED,
    executionId: "",
    trackingTimeoutMinutes: trackingBudget,
    failureReason: "",
  };
  switch (outcome.kind) {
    case "started":
      result.outcome = outcome.alreadyExisted ? RUN_ALREADY_STARTED : RUN_STARTED;
      result.executionId = outcome.executionId;
      deps.logger.info("Schedule fire started its run", {
        schedule_id: scheduleResourceId,
        execution_id: outcome.executionId,
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
  // The fire ledger (DD-017 D-7): start failures are terminal at insert —
  // the refusal reason must survive NOW, not at the pause threshold.
  await recordRunLedgerStart(
    deps.store,
    deps.logger,
    scheduleResourceId,
    schedule.metadata?.org ?? "",
    nominalFireTimeRfc3339,
    RUN_LEDGER_ORIGIN_CRON,
    result,
  );
  return result;
}

/**
 * Classifies the tracked run's current phase from one row read. GONE (row
 * deleted mid-track) is distinct from RUNNING: a deleted run must not
 * brick its schedule, so it yields no verdict.
 *
 * The read unmarshals the whole execution row — SQLite stores one protobuf
 * blob with no projection (DD-015 D-E). At one poll per 5-60s per active
 * run on a single-user daemon that is noise; a projected phase column is
 * the named follow-up if it ever isn't (Go PollExecutionPhase).
 */
async function pollExecutionPhase(
  deps: ScheduleTickActivityDeps,
  executionId: string,
): Promise<RunPhase> {
  let phase: ExecutionPhase;
  try {
    const execution = await deps.store.getResource(
      ApiResourceKind.agent_execution,
      executionId,
      AgentExecutionSchema,
    );
    phase = execution.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return PHASE_GONE;
    }
    throw new Error(`load execution ${executionId}: ${message(error)}`, {
      cause: error,
    });
  }

  switch (phase) {
    case ExecutionPhase.EXECUTION_COMPLETED:
      return PHASE_COMPLETED;
    case ExecutionPhase.EXECUTION_CANCELLED:
      return PHASE_CANCELLED;
    case ExecutionPhase.EXECUTION_TERMINATED:
      return PHASE_TERMINATED;
    case ExecutionPhase.EXECUTION_FAILED:
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
 * healthy schedule later, so this write must land (Go RecordSuccessfulRun).
 */
async function recordSuccessfulRun(
  deps: ScheduleTickActivityDeps,
  scheduleResourceId: string,
): Promise<void> {
  try {
    await deps.store.updateResource(
      ApiResourceKind.schedule,
      scheduleResourceId,
      ScheduleSchema,
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
      `reset failure streak on schedule ${scheduleResourceId}: ${message(error)}`,
      { cause: error },
    );
  }
  await recordRunLedgerVerdict(
    deps.store,
    deps.logger,
    scheduleResourceId,
    RUN_LEDGER_OUTCOME_COMPLETED,
    "",
  );
  deps.logger.info("Schedule run completed — failure streak reset", {
    schedule_id: scheduleResourceId,
  });
}

/**
 * Increments the failure streak and, exactly at the threshold crossing,
 * latches the platform pause. The whole verdict is ONE updateResource
 * closure on the freshly-read row — the OSS shape of the cloud's single
 * guarded SQL statement (DD-015 D-C): the increment reads the live value
 * inside the lock, the pause is written only at the crossing and only when
 * no reason is already latched (the first pause's copy is never
 * rewritten), and next_fire_at clears so the schedule advertises no fire
 * it will decline.
 *
 * The caller gives this activity EXACTLY ONE attempt: an increment is not
 * idempotent — a retry after a successful write over-counts and pauses a
 * healthy schedule early, while a lost write under-counts and fails safe
 * (Go RecordFailedRun).
 */
async function recordFailedRun(
  deps: ScheduleTickActivityDeps,
  scheduleResourceId: string,
  reason: string,
  kind: FailureKind,
): Promise<FailureRecorded> {
  const threshold = deps.config.resolvedMaxConsecutiveFailures();
  const pausedReason = `Paused after ${threshold} consecutive failed runs. Last failure: ${reason}`;

  let recorded: FailureRecorded = { consecutiveFailures: 0, paused: false };
  let crossedThreshold = false;
  try {
    await deps.store.updateResource(
      ApiResourceKind.schedule,
      scheduleResourceId,
      ScheduleSchema,
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
      // schedule must never resurrect either.
      deps.logger.info(
        "Schedule run failure not recorded — row deleted mid-track",
        { schedule_id: scheduleResourceId, reason },
      );
      return { consecutiveFailures: 0, paused: false };
    }
    throw new Error(
      `record failed run on schedule ${scheduleResourceId}: ${message(error)}`,
      { cause: error },
    );
  }

  deps.logger.warn("Schedule run failed", {
    failure_kind: kind,
    schedule_id: scheduleResourceId,
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
        scheduleResourceId,
        RUN_LEDGER_OUTCOME_FAILED,
        reason,
      );
      break;
    case FAILURE_RUN_TIMED_OUT:
      await recordRunLedgerVerdict(
        deps.store,
        deps.logger,
        scheduleResourceId,
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
      const schedule = await deps.store.getResource(
        ApiResourceKind.schedule,
        scheduleResourceId,
        ScheduleSchema,
      );
      await deps.syncer.ensureAndRecord(schedule);
    } catch (error) {
      deps.logger.error(
        "Paused schedule's artifact not yet converged (the reconciliation pass will pause it)",
        { schedule_id: scheduleResourceId, error: message(error) },
      );
    }
  }
  return recorded;
}

/** Go time.Parse(time.RFC3339) — an unparseable nominal time fails the activity. */
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

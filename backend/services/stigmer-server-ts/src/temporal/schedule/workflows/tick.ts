/**
 * The tick workflow — ports pkg/domain/schedule/temporal/tick_workflow.go:
 * one schedule fire, spanning its run (DD-013 via DD-015): record the
 * fire, start the run, poll it to a terminal phase, record the verdict.
 * Spanning is what makes the artifact's overlap SKIP genuinely mean "never
 * start a run while the last is active", and the verdict is what feeds the
 * failure streak behind the platform auto-pause.
 *
 * WHY A TIMER-DRIVEN POLL AND NOT THE CALLBACK TOKEN — read before
 * "fixing" this. The platform already uses async activity completion for
 * call:agent, so the token is the tempting shape here too. It loses on
 * grounds that are edition-neutral (DD-015 D-E): the token cannot be
 * re-armed after a create-then-crash, and its completion fire is
 * best-effort — two silent-hang modes on a surface where a hang is a
 * silenced reminder. The poll holds no worker thread (the workflow is
 * dormant between polls; each poll is a millisecond activity), is bounded
 * twice (budget + MAX_TRACKING_CYCLES), and keeps ONE verdict matrix
 * across both editions.
 *
 * FORWARD CONSTRAINT: ticks live for minutes-to-an-hour once tracking is
 * real, and OSS releases cut every 1-3 days — an in-flight tick WILL
 * straddle a binary upgrade. Any behavioral change to this workflow body
 * must be gated with patched()/deprecatePatch() (OD-6 discipline), and the
 * replay gate (__tests__/replay.test.ts) must stay green against the
 * committed histories.
 *
 * ERROR POSTURE (the #18 panel lesson, applied from day one): Go's
 * `return err` fails the WORKFLOW EXECUTION; a plain thrown Error in the
 * TS sandbox fails only the workflow TASK and retries forever. Every Go
 * error return is therefore an ApplicationFailure here. Cancellation
 * (sleep throwing CancelledFailure) propagates untouched — Go's
 * workflow.Sleep error return, same terminal outcome.
 *
 * WORKFLOW-BUNDLE IMPORT DISCIPLINE: this module runs in the deterministic
 * sandbox — imports are limited to @temporalio/workflow, @temporalio/common,
 * and the pure names module.
 */
import {
  ApplicationFailure,
  isCancellation,
  proxyActivities,
  sleep,
  workflowInfo,
  log,
} from "@temporalio/workflow";
import {
  SearchAttributeType,
  defineSearchAttributeKey,
} from "@temporalio/common";

import {
  FAILURE_RUN_FAILED,
  FAILURE_RUN_TIMED_OUT,
  FAILURE_START_FAILED,
  PHASE_COMPLETED,
  PHASE_GONE,
  PHASE_RUNNING,
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
  artifactId,
  type FailureRecorded,
  type RunPhase,
  type RunStart,
  type ScheduleTickActivities,
} from "../names.js";

/**
 * The tracking loop's code-level backstop, on top of the per-fire budget:
 * 240 polls at the capped backoff is ~3.9 hours and ~1,200 history
 * events — the loop can never outgrow a workflow history even if a budget
 * is misconfigured (Go MaxTrackingCycles; exported so the bound test can
 * assert it).
 */
export const MAX_TRACKING_CYCLES = 240;

/**
 * The nominal fire time Temporal stamps on every schedule-started
 * workflow — tier one of the nominal-time derivation (present on cron
 * fires AND manual triggers alike; Go scheduledStartTimeKey).
 */
const SCHEDULED_START_TIME_KEY = defineSearchAttributeKey(
  "TemporalScheduledStartTime",
  SearchAttributeType.DATETIME,
);

// The three activity-option contexts (Go tick_workflow.go). Record stub:
// short idempotent status writes, retried freely.
const recordActivities = proxyActivities<ScheduleTickActivities>({
  startToCloseTimeout: "30 seconds",
  retry: {
    maximumAttempts: 3,
    initialInterval: "5 seconds",
    backoffCoefficient: 2.0,
  },
});
// Run-start stub: enters the full create pipeline (session, context,
// workflow start) — minutes-scale timeout, still retried (the
// deterministic execution name absorbs retries).
const startActivities = proxyActivities<ScheduleTickActivities>({
  startToCloseTimeout: "3 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "5 seconds",
    backoffCoefficient: 2.0,
  },
});
// Failure-record stub: EXACTLY ONE attempt — the streak increment is the
// clock's single non-idempotent write. A retry after a successful write
// over-counts and pauses a healthy schedule early; a lost write
// under-counts, which fails safe.
const failureActivities = proxyActivities<ScheduleTickActivities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 1 },
});

/**
 * Executes one tick (Go TickWorkflow.Run; registered as "schedule/tick"
 * via the barrel). The single argument is the schedule resource id
 * (Temporal bakes action args once — the nominal fire time is derived,
 * never carried).
 */
export async function tick(scheduleResourceId: string): Promise<void> {
  const nominal = nominalFireTime(scheduleResourceId);
  const nominalRfc3339 = rfc3339Seconds(nominal);

  const tickOutcome = await failing(
    "record tick",
    recordActivities[RECORD_TICK_ACTIVITY_NAME](
      scheduleResourceId,
      nominalRfc3339,
    ),
  );
  if (tickOutcome !== TICK_FIRED) {
    log.info("Schedule tick complete", {
      schedule_id: scheduleResourceId,
      nominal_fire_time: nominalRfc3339,
      outcome: tickOutcome,
    });
    return;
  }

  const runStart = await failing(
    "start scheduled run",
    startActivities[START_SCHEDULED_RUN_ACTIVITY_NAME](
      scheduleResourceId,
      nominalRfc3339,
    ),
  );

  switch (runStart.outcome) {
    case RUN_SKIPPED:
      log.info("Schedule tick complete", {
        schedule_id: scheduleResourceId,
        nominal_fire_time: nominalRfc3339,
        run_outcome: runStart.outcome,
      });
      return;
    case RUN_TARGET_MISSING:
    case RUN_REFUSED: {
      // The run never existed: the streak counts the fire, the completion
      // verdicts do not.
      const recorded = await failing(
        "record start failure",
        failureActivities[RECORD_FAILED_RUN_ACTIVITY_NAME](
          scheduleResourceId,
          runStart.failureReason,
          FAILURE_START_FAILED,
        ),
      );
      log.info("Schedule tick complete", {
        schedule_id: scheduleResourceId,
        nominal_fire_time: nominalRfc3339,
        run_outcome: runStart.outcome,
        verdict: "start_failed",
        consecutive_failures: recorded.consecutiveFailures,
        paused: recorded.paused,
      });
      return;
    }
    case RUN_STARTED:
    case RUN_ALREADY_STARTED:
      await trackRun(scheduleResourceId, nominalRfc3339, runStart);
      return;
    default:
      throw ApplicationFailure.nonRetryable(
        `unknown run outcome "${runStart.outcome}"`,
      );
  }
}

/**
 * Polls the run to a terminal phase within this fire's budget and records
 * the verdict (Go trackRun).
 */
async function trackRun(
  scheduleResourceId: string,
  nominalRfc3339: string,
  runStart: RunStart,
): Promise<void> {
  const deadline = Date.now() + runStart.trackingTimeoutMinutes * 60_000;

  let phase: RunPhase = PHASE_RUNNING;
  let budgetExhausted = false;
  // Poll-first, deadline checked after each poll and before each sleep: an
  // ALREADY_STARTED retry may already be terminal, and the loop must never
  // sleep past its own deadline.
  for (let cycle = 1; ; cycle++) {
    if (cycle > MAX_TRACKING_CYCLES) {
      budgetExhausted = true;
      break;
    }
    // DB unreachable past the activity's own retries: fail the tick with
    // NO verdict — guessing "failed" during an outage could pause a
    // healthy schedule. The artifact stays armed (PauseOnFailure=false);
    // the next fire is unaffected.
    phase = await failing(
      "poll execution phase",
      recordActivities[POLL_EXECUTION_PHASE_ACTIVITY_NAME](runStart.executionId),
    );
    if (phase !== PHASE_RUNNING) {
      break;
    }
    if (Date.now() >= deadline) {
      budgetExhausted = true;
      break;
    }
    await sleep(trackingBackoffMs(cycle));
  }

  if (budgetExhausted) {
    // The run is NOT cancelled: its own execution profile bounds spend,
    // and a destructive act buys nothing. Under SKIP this budget is
    // literally the maximum time one hung run may silence the schedule.
    const reason = `run ${runStart.executionId} did not finish within ${runStart.trackingTimeoutMinutes} minutes`;
    const recorded = await failing(
      "record tracking timeout",
      failureActivities[RECORD_FAILED_RUN_ACTIVITY_NAME](
        scheduleResourceId,
        reason,
        FAILURE_RUN_TIMED_OUT,
      ),
    );
    logVerdict(scheduleResourceId, nominalRfc3339, runStart, "timed_out", recorded);
    return;
  }
  if (phase === PHASE_COMPLETED) {
    await failing(
      "record successful run",
      recordActivities[RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME](scheduleResourceId),
    );
    logVerdict(scheduleResourceId, nominalRfc3339, runStart, "completed");
    return;
  }
  if (phase === PHASE_GONE) {
    // Deleting a run must not brick its schedule: no verdict.
    logVerdict(scheduleResourceId, nominalRfc3339, runStart, "gone");
    return;
  }
  // FAILED, CANCELLED, TERMINATED.
  const reason = `run ${runStart.executionId} ended ${phase.toLowerCase()}`;
  const recorded = await failing(
    "record failed run",
    failureActivities[RECORD_FAILED_RUN_ACTIVITY_NAME](
      scheduleResourceId,
      reason,
      FAILURE_RUN_FAILED,
    ),
  );
  logVerdict(
    scheduleResourceId,
    nominalRfc3339,
    runStart,
    phase.toLowerCase(),
    recorded,
  );
}

/**
 * The delay before the next phase poll: linear cycle×5s capped at 60s —
 * recoveryBackoff's exact shape, the only backoff curve this platform runs
 * in production workflow code. It notices a 30-120s run (the common case)
 * within seconds and reaches its cap by cycle twelve, bounding poll volume
 * on long runs (Go trackingBackoff).
 */
function trackingBackoffMs(cycle: number): number {
  const ms = cycle * 5_000;
  return ms > 60_000 ? 60_000 : ms;
}

/**
 * Derives THE fire's nominal time, three tiers (Go nominalFireTime):
 *  1. The TemporalScheduledStartTime search attribute (cron fires and
 *     manual triggers both carry it — spike-verified on the Go side).
 *  2. The workflow-id suffix Temporal appends to the artifact's base id.
 *  3. Workflow time truncated to whole seconds (a hand-started tick).
 *
 * The nominal time is the fire's identity: last_fire_at records it and the
 * execution name derives from it, so both idempotency keys agree on every
 * retry.
 */
function nominalFireTime(scheduleResourceId: string): Date {
  const attribute = workflowInfo().typedSearchAttributes.get(
    SCHEDULED_START_TIME_KEY,
  );
  if (attribute !== undefined) {
    return attribute;
  }
  const base = `${artifactId(scheduleResourceId)}-`;
  const workflowId = workflowInfo().workflowId;
  if (workflowId.startsWith(base)) {
    const suffix = workflowId.slice(base.length);
    // Go time.Parse(time.RFC3339) is strict; Date() is lenient — the
    // pattern guard keeps a non-RFC3339 suffix falling to tier 3 exactly
    // as Go's parse error does.
    if (RFC3339_PATTERN.test(suffix)) {
      const parsed = new Date(suffix);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }
  // Date.now() is deterministic workflow time inside the sandbox — Go's
  // workflow.Now twin.
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}

/**
 * Maps a failed activity to Go's `return fmt.Errorf("<label>: %w", err)` —
 * a WORKFLOW failure (see the module header's error posture). Cancellation
 * failures propagate untouched.
 */
async function failing<T>(label: string, promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ApplicationFailure || isCancellation(error)) {
      throw error;
    }
    throw ApplicationFailure.create({
      message: `${label}: ${error instanceof Error ? error.message : String(error)}`,
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/** Anchored RFC-3339 shape (Z or numeric offset, optional fraction). */
const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Go time.RFC3339, UTC whole seconds (the wire shape the activities pin). */
function rfc3339Seconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function logVerdict(
  scheduleResourceId: string,
  nominalRfc3339: string,
  runStart: RunStart,
  verdict: string,
  recorded?: FailureRecorded,
): void {
  if (recorded === undefined) {
    log.info("Schedule tick complete", {
      schedule_id: scheduleResourceId,
      nominal_fire_time: nominalRfc3339,
      run_outcome: runStart.outcome,
      execution_id: runStart.executionId,
      verdict,
    });
    return;
  }
  log.info("Schedule tick complete", {
    schedule_id: scheduleResourceId,
    nominal_fire_time: nominalRfc3339,
    run_outcome: runStart.outcome,
    execution_id: runStart.executionId,
    verdict,
    consecutive_failures: recorded.consecutiveFailures,
    paused: recorded.paused,
  });
}

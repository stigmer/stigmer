/**
 * The grading workflow: one completed run, graded by the free run-health
 * checks and, where the run's agent has AI grading switched on, by an AI
 * judge, each recorded as a score.
 *
 * Run health first: one activity grades and records; when it fails past
 * its retries, a second records the run as not graded, because a failed
 * grade is never a missing or failing value.
 *
 * Then the judge (judge-activities.ts), behind the `grade-run-judge`
 * patch: an execution started before the judge existed replays without
 * the marker and ends after run health, as it always did. The planner
 * decides whether to grade and sets the cost aside; the start creates the
 * judge run, retrying a capacity refusal for up to ten minutes; the
 * workflow polls the judge run on a capped backoff for up to ten minutes;
 * and the record writes the verdict or the reason there is none, deletes
 * the judge's session and settles the budget. Every path past the planner
 * ends in the record, retried for up to twenty minutes, so a reservation
 * is settled and a judge session deleted unless the store is out longer
 * than that. Run health's outcome stays the workflow's result.
 *
 * WORKFLOW-BUNDLE IMPORT DISCIPLINE: this module runs in the deterministic
 * sandbox; imports are limited to @temporalio/workflow and the pure names
 * module.
 */
import {
  ActivityFailure,
  ApplicationFailure,
  isCancellation,
  patched,
  proxyActivities,
  sleep,
} from "@temporalio/workflow";

import {
  GRADE_RUN_HEALTH_ACTIVITY_NAME,
  GRADE_RUN_JUDGE_PATCH,
  GRADING_FAILED_REASON,
  JUDGE_BUSY_FAILURE_TYPE,
  PLAN_JUDGE_ACTIVITY_NAME,
  POLL_JUDGE_ACTIVITY_NAME,
  RECORD_JUDGE_ACTIVITY_NAME,
  RECORD_NOT_GRADED_ACTIVITY_NAME,
  START_JUDGE_ACTIVITY_NAME,
} from "../names.js";
import type {
  GradeOutcome,
  GradingActivities,
  JudgeActivities,
  JudgeFailure,
} from "../names.js";

const activities = proxyActivities<GradingActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 5,
  },
});

/** The planner, the poll and the record: quick store work, retried as run health is. */
const judgeSteps = proxyActivities<JudgeActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 5,
  },
});

/**
 * The record: the grade, the settlement and the judge session's cleanup,
 * retried for up to twenty minutes, so a store outage of that length does
 * not leave the run "grading" with its cap set aside. Past that the
 * execution fails and the month's rollover returns the cap.
 */
const judgeRecord = proxyActivities<JudgeActivities>({
  startToCloseTimeout: "1 minute",
  scheduleToCloseTimeout: "20 minutes",
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
  },
});

/**
 * The start: the judge run's create, retried while the platform refuses it
 * for capacity (JUDGE_BUSY_FAILURE_TYPE) for at most ten minutes in all.
 */
const judgeStart = proxyActivities<JudgeActivities>({
  startToCloseTimeout: "1 minute",
  scheduleToCloseTimeout: "10 minutes",
  retry: {
    initialInterval: "15 seconds",
    backoffCoefficient: 1.5,
    maximumInterval: "1 minute",
  },
});

/** How long the judge run may take before it is stopped and the run not graded. */
const JUDGE_RUN_BUDGET_MS = 10 * 60 * 1000;

/** The poll's first wait and its cap: a judge run takes seconds to a minute. */
const POLL_FIRST_MS = 3_000;
const POLL_CAP_MS = 15_000;

export async function gradeRun(runId: string): Promise<GradeOutcome> {
  let outcome: GradeOutcome;
  try {
    outcome = await activities[GRADE_RUN_HEALTH_ACTIVITY_NAME](runId);
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
    outcome = await activities[RECORD_NOT_GRADED_ACTIVITY_NAME](
      runId,
      GRADING_FAILED_REASON,
    );
  }
  if (patched(GRADE_RUN_JUDGE_PATCH)) {
    await judge(runId);
  }
  return outcome;
}

async function judge(runId: string): Promise<void> {
  let plan;
  try {
    plan = await judgeSteps[PLAN_JUDGE_ACTIVITY_NAME](runId);
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
    return;
  }
  if (plan.kind !== "grade") {
    return;
  }

  let judgeRunId = "";
  let failure: JudgeFailure = "";
  try {
    const start = await judgeStart[START_JUDGE_ACTIVITY_NAME](runId, plan.ticket);
    if (start.kind === "started") {
      judgeRunId = start.judgeRunId;
    } else {
      failure = start.failure;
    }
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
    failure = isBusy(error) ? "busy" : "not-started";
  }

  if (judgeRunId !== "") {
    failure = await awaitJudge(judgeRunId);
  }

  await judgeRecord[RECORD_JUDGE_ACTIVITY_NAME](
    runId,
    plan.ticket,
    judgeRunId,
    failure,
  );
}

/** Polls the judge run until it ends, or answers "not-finished" past its budget. */
async function awaitJudge(judgeRunId: string): Promise<JudgeFailure> {
  const deadline = Date.now() + JUDGE_RUN_BUDGET_MS;
  let wait = POLL_FIRST_MS;
  for (;;) {
    await sleep(wait);
    try {
      if (await judgeSteps[POLL_JUDGE_ACTIVITY_NAME](judgeRunId)) {
        return "";
      }
    } catch (error) {
      if (isCancellation(error)) {
        throw error;
      }
    }
    if (Date.now() >= deadline) {
      return "not-finished";
    }
    wait = Math.min(wait + POLL_FIRST_MS, POLL_CAP_MS);
  }
}

/**
 * Whether the start failed for capacity, past its retries. When the ten
 * minutes run out mid-retry the activity's failure is a timeout whose cause
 * is the last attempt's, so the chain is walked.
 */
function isBusy(error: unknown): boolean {
  if (!(error instanceof ActivityFailure)) {
    return false;
  }
  let cause: unknown = error.cause;
  while (cause instanceof Error) {
    if (cause instanceof ApplicationFailure && cause.type === JUDGE_BUSY_FAILURE_TYPE) {
      return true;
    }
    cause = cause.cause;
  }
  return false;
}

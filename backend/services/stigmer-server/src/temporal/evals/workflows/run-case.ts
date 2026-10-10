/**
 * One try of a plugin eval: start it, wait for it within the case's time,
 * grade it, and report to the suite workflow, which alone writes the
 * eval's status.
 *
 *   - Start: the try's session and run, as the eval's caller. A capacity
 *     refusal is retried for up to thirty minutes, then the try is not
 *     graded, "platform busy"; a credit refusal is reported so the suite
 *     stops; a target the organization cannot start is not graded with the
 *     run's own refusal.
 *   - Wait: the run is polled on a capped backoff (the grade-run
 *     workflow's shape) until it ends or the case's `timeout_seconds`
 *     pass. At the deadline the run is stopped and graded on what it
 *     produced, with the error "timed out after Ns", as the format grades
 *     a timeout.
 *   - Grade: the code graders over the try's trace; then each AI-graded
 *     check's three votes, one after another, each a judge run in a session
 *     of its own, each read and its session deleted before the next.
 *   - Record: the votes tallied (two of three decide), the try's score,
 *     and its Score on its run.
 *
 * A platform failure (busy, grading that fails past its retries, a vote
 * that cannot run) leaves the try not graded, never a zero. When the suite
 * is cancelled, this workflow stops the try's run before it ends, so a
 * cancelled eval leaves no run going.
 *
 * WORKFLOW-BUNDLE IMPORT DISCIPLINE: this module runs in the deterministic
 * sandbox; imports are limited to @temporalio/workflow and the pure names
 * module.
 */
import {
  ActivityFailure,
  ApplicationFailure,
  CancellationScope,
  isCancellation,
  proxyActivities,
  sleep,
} from "@temporalio/workflow";

import {
  CANNOT_ACT_REASON,
  GRADE_TRY_ACTIVITY_NAME,
  GRADING_FAILED_REASON,
  OUT_OF_CREDIT_REASON,
  PLATFORM_BUSY_REASON,
  PLUGIN_EVAL_BUSY_FAILURE_TYPE,
  POLL_RUN_ACTIVITY_NAME,
  READ_VOTE_ACTIVITY_NAME,
  RECORD_SCORE_ACTIVITY_NAME,
  START_TRY_ACTIVITY_NAME,
  START_VOTE_ACTIVITY_NAME,
  STOP_RUN_ACTIVITY_NAME,
} from "../names.js";
import type {
  CaseActivities,
  CaseInput,
  TryGrade,
  TryResult,
  VoteRead,
} from "../names.js";

/** Quick store work: the poll, the stop, the vote's read. */
const steps = proxyActivities<CaseActivities>({
  startToCloseTimeout: "1 minute",
  retry: { initialInterval: "2 seconds", backoffCoefficient: 2, maximumAttempts: 5 },
});

/** The grade and the record: the trace and the archive, read in full. */
const grading = proxyActivities<CaseActivities>({
  startToCloseTimeout: "5 minutes",
  retry: { initialInterval: "2 seconds", backoffCoefficient: 2, maximumAttempts: 5 },
});

/** A try's start: a capacity refusal is retried for thirty minutes in all. */
const tryStart = proxyActivities<CaseActivities>({
  startToCloseTimeout: "1 minute",
  scheduleToCloseTimeout: "30 minutes",
  retry: { initialInterval: "15 seconds", backoffCoefficient: 1.5, maximumInterval: "2 minutes" },
});

/** A vote's start: as the judge's, ten minutes of capacity retries. */
const voteStart = proxyActivities<CaseActivities>({
  startToCloseTimeout: "1 minute",
  scheduleToCloseTimeout: "10 minutes",
  retry: { initialInterval: "15 seconds", backoffCoefficient: 1.5, maximumInterval: "1 minute" },
});

/** How long a vote may run before it is stopped and counted as failed. */
const VOTE_BUDGET_MS = 10 * 60 * 1000;

/** How long a stopped try is waited for before it is graded anyway. */
const STOP_GRACE_MS = 2 * 60 * 1000;

/** The poll's first wait and its cap. */
const POLL_FIRST_MS = 3_000;
const POLL_CAP_MS = 15_000;

/** The votes each AI-graded check takes (graders/llm.ts VOTES_PER_CHECK). */
const VOTES_PER_CHECK = 3;

export async function runCase(input: CaseInput): Promise<TryResult> {
  let started;
  try {
    started = await tryStart[START_TRY_ACTIVITY_NAME](input);
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
    return notGraded("", "", isBusy(error) ? PLATFORM_BUSY_REASON : GRADING_FAILED_REASON);
  }
  if (started.kind === "refused") {
    switch (started.failure) {
      case "out-of-credit":
        return { ...notGraded("", "", OUT_OF_CREDIT_REASON), outOfCredit: true };
      case "cannot-act":
        return notGraded("", "", CANNOT_ACT_REASON);
      case "not-started":
        return notGraded("", "", started.reason);
      default: {
        const exhausted: never = started.failure;
        return exhausted;
      }
    }
  }

  const { sessionId, runId } = started;
  let timedOut: boolean;
  try {
    timedOut = !(await awaitRun(runId, input.timeoutSeconds * 1000));
    if (timedOut) {
      await steps[STOP_RUN_ACTIVITY_NAME](runId, `timed out after ${input.timeoutSeconds}s`);
      await awaitRun(runId, STOP_GRACE_MS);
    }
  } catch (error) {
    if (isCancellation(error)) {
      await CancellationScope.nonCancellable(() =>
        steps[STOP_RUN_ACTIVITY_NAME](runId, "the eval was cancelled"),
      );
    }
    throw error;
  }

  let grade: TryGrade;
  try {
    grade = await grading[GRADE_TRY_ACTIVITY_NAME](input, runId, timedOut);
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
    return notGraded(sessionId, runId, GRADING_FAILED_REASON);
  }

  let voteCost = 0;
  const votes: Array<ReadonlyArray<VoteRead["vote"]>> = [];
  for (const [graderIndex, outcome] of grade.outcomes.entries()) {
    const cast: VoteRead["vote"][] = [];
    if ("votes" in outcome) {
      for (let voteIndex = 0; voteIndex < VOTES_PER_CHECK; voteIndex++) {
        const read = await vote(input, runId, graderIndex, voteIndex, outcome.votes);
        voteCost += read.costUsd;
        cast.push(read.vote);
      }
    }
    votes.push(cast);
  }

  const graded: TryGrade = { ...grade, costUsd: grade.costUsd + voteCost };
  try {
    return await grading[RECORD_SCORE_ACTIVITY_NAME](input, { sessionId, runId }, graded, votes);
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
    return {
      ...notGraded(sessionId, runId, GRADING_FAILED_REASON),
      error: graded.error,
      costUsd: graded.costUsd,
      durationSeconds: graded.durationSeconds,
    };
  }
}

/** One vote: start, wait within its budget, read (graders/llm.ts). */
async function vote(
  input: CaseInput,
  runId: string,
  graderIndex: number,
  voteIndex: number,
  rubric: string,
): Promise<VoteRead> {
  let start;
  try {
    start = await voteStart[START_VOTE_ACTIVITY_NAME](input, runId, graderIndex, voteIndex);
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
    return {
      vote: { kind: "failed", reason: isBusy(error) ? PLATFORM_BUSY_REASON : "the judge could not start" },
      costUsd: 0,
    };
  }
  if (start.kind === "failed") {
    return { vote: { kind: "failed", reason: start.reason }, costUsd: 0 };
  }
  try {
    await awaitRun(start.voteRunId, VOTE_BUDGET_MS);
  } catch (error) {
    if (isCancellation(error)) {
      await CancellationScope.nonCancellable(() =>
        steps[STOP_RUN_ACTIVITY_NAME](start.voteRunId, "the eval was cancelled"),
      );
    }
    throw error;
  }
  return steps[READ_VOTE_ACTIVITY_NAME](start.voteRunId, rubric);
}

/** Polls `runId` until it ends (true) or `budgetMs` pass (false). */
async function awaitRun(runId: string, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  let wait = POLL_FIRST_MS;
  for (;;) {
    await sleep(Math.max(1, Math.min(wait, deadline - Date.now())));
    try {
      if (await steps[POLL_RUN_ACTIVITY_NAME](runId)) {
        return true;
      }
    } catch (error) {
      if (isCancellation(error)) {
        throw error;
      }
    }
    if (Date.now() >= deadline) {
      return false;
    }
    wait = Math.min(wait + POLL_FIRST_MS, POLL_CAP_MS);
  }
}

function notGraded(sessionId: string, runId: string, reason: string): TryResult {
  return {
    sessionId,
    runId,
    state: "not-graded",
    score: 0,
    notGradedReason: reason,
    error: "",
    costUsd: 0,
    durationSeconds: 0,
    graderResults: [],
    outOfCredit: false,
  };
}

/** Whether a start failed for capacity past its retries (the grade-run workflow's walk). */
function isBusy(error: unknown): boolean {
  if (!(error instanceof ActivityFailure)) {
    return false;
  }
  let cause: unknown = error.cause;
  while (cause instanceof Error) {
    if (cause instanceof ApplicationFailure && cause.type === PLUGIN_EVAL_BUSY_FAILURE_TYPE) {
      return true;
    }
    cause = cause.cause;
  }
  return false;
}

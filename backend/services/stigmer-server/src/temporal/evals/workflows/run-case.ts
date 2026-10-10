/**
 * One try of a plugin eval: start it, wait for it within the case's time,
 * grade it, and report to the suite workflow, which alone writes the
 * eval's status.
 *
 *   - Start: the try's session and run, as the eval's caller, the run
 *     capped at the budget the suite passes (its equal share of what the
 *     eval has left, the suite workflow's tryBudgetUsd). A capacity refusal is retried for up to thirty minutes, then
 *     the try is not graded, "platform busy"; a credit refusal is reported
 *     so the suite stops; a target the organization cannot start is not
 *     graded with the run's own refusal.
 *   - Wait: the run is polled on a capped backoff (the grade-run
 *     workflow's shape) until it ends or the case's `timeout_seconds`
 *     pass, counted from when the run started: its `status.started_at`,
 *     or the first poll that saw it out of pending. At the deadline the run
 *     is stopped and graded on what it produced, with the error "timed out
 *     after Ns", as the format grades a timeout. A run no runner took
 *     within the capacity wait (thirty minutes, the start's own capacity
 *     rule) is stopped and never scored: the try is not graded, "platform
 *     busy", as a try that waited for capacity never counts as a zero.
 *   - Grade: the code graders over the try's trace; then each AI-graded
 *     check's three votes, one after another, each a judge run in a session
 *     of its own, each read and then its session deleted before the next
 *     (two steps, so a retried read reads the same vote; a vote's cost
 *     joins the workflow's tally once its session, which held it, is
 *     deleted; a vote whose delete fails past its retries is still stored,
 *     so where the spend activity is read it counts that vote, and the
 *     tally only where it is not). A vote whose read fails past its
 *     retries is stopped, and the try is not graded, "the AI-graded check
 *     could not be read", with what its run and every vote spent (the
 *     unread vote's read from its stored run).
 *   - Record: the votes tallied (two of three decide), the try's score,
 *     and its Score on its run.
 *
 * A platform failure (busy, a start or grading that fails past its
 * retries, a stop that fails, a vote that cannot run) leaves the try not
 * graded, never a zero, and still carries what the try's run spent: read
 * through the spend activity where this workflow has no grade to read it
 * from, so the suite's ceiling counts every dollar a run used.
 *
 * Any other error the workflow meets (one of its own, not an activity's)
 * fails it outright, as a non-retryable ApplicationFailure of type
 * PLUGIN_EVAL_CASE_FAILED_FAILURE_TYPE: Temporal fails only the workflow
 * task on a plain error, and would retry that task until the execution
 * timeout, so the suite records such a try as a failed child instead. The
 * failure's details carry what the votes already read spent
 * (CaseFailureDetails), since their runs are deleted and the suite's
 * spend read cannot find them.
 * Before it fails, the try's run and any vote's run it knows are stopped,
 * in a non-cancellable scope, so nothing it started keeps spending.
 *
 * History: the try's workflow stays well under Temporal's event cap
 * (51,200) at the limits. A poll is about eleven events (its timer, the
 * activity, two workflow tasks). The try's run polls at most about 125
 * times while it waits for a runner and about 245 while it runs (3,600 s
 * at 15 s), and each of the 96 votes (32 AI-graded checks, three votes
 * each) about 20 within its ten minutes, its poll backing off to a minute:
 * about 2,300 polls, some 25,000 events, with the votes' starts, reads and
 * deletes about 2,000 more.
 *
 * Cancel: when the suite is cancelled, this workflow stops the try's run
 * and any vote's run going, in a non-cancellable scope, waits for the
 * try's run to end, and answers the try not graded, "cancelled", with its
 * ids and what it spent, so the suite records it and counts its cost. The
 * activities wait for their cancellation to complete, so a start running
 * when the cancel arrives finishes and its run is known, and a score's
 * record or a vote's read finishes before the cancel's own reads; a start
 * whose answer is still lost (a cancel between its attempts) has its run
 * found by the spend activity, by the eval's label and the try's run name.
 * A cancelled eval leaves no run going.
 *
 * WORKFLOW-BUNDLE IMPORT DISCIPLINE: this module runs in the deterministic
 * sandbox; imports are limited to @temporalio/workflow and the pure names
 * module.
 */
import {
  ActivityCancellationType,
  ActivityFailure,
  ApplicationFailure,
  CancellationScope,
  isCancellation,
  proxyActivities,
  sleep,
  TemporalFailure,
} from "@temporalio/workflow";

import {
  CANNOT_ACT_REASON,
  DELETE_VOTE_ACTIVITY_NAME,
  GRADE_TRY_ACTIVITY_NAME,
  GRADING_FAILED_REASON,
  OUT_OF_CREDIT_REASON,
  PLATFORM_BUSY_REASON,
  PLUGIN_EVAL_BUSY_FAILURE_TYPE,
  PLUGIN_EVAL_CASE_FAILED_FAILURE_TYPE,
  POLL_RUN_ACTIVITY_NAME,
  READ_VOTE_ACTIVITY_NAME,
  RECORD_SCORE_ACTIVITY_NAME,
  START_TRY_ACTIVITY_NAME,
  START_VOTE_ACTIVITY_NAME,
  STOP_RUN_ACTIVITY_NAME,
  TRY_CANCELLED_REASON,
  TRY_NOT_STARTED_REASON,
  TRY_NOT_STOPPED_REASON,
  TRY_SPEND_ACTIVITY_NAME,
  VOTE_NOT_READ_REASON,
} from "../names.js";
import type {
  CaseActivities,
  CaseFailureDetails,
  CaseInput,
  RunPoll,
  SpendActivities,
  TryGrade,
  TryResult,
  TrySpend,
  VoteRead,
} from "../names.js";

/**
 * Quick store work: the poll, the stop, the vote's read, the spend read.
 * A cancel waits for the attempt running to finish, so a vote's read is
 * never cut off between deleting its session and answering its cost.
 */
const steps = proxyActivities<CaseActivities & SpendActivities>({
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 5,
  },
});

/**
 * The grade and the record: the trace and the archive, read in full. A
 * cancel waits for the attempt running to finish, so a Score is never
 * written after the try is answered cancelled.
 */
const grading = proxyActivities<CaseActivities>({
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  startToCloseTimeout: "5 minutes",
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 5,
  },
});

/**
 * A try's start: a capacity refusal is retried for thirty minutes in all.
 * A cancel waits for the attempt running to finish, so the run it creates
 * is known and stopped (an attempt is a few store writes, well inside its
 * minute, so it needs no heartbeat).
 */
const tryStart = proxyActivities<CaseActivities>({
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  startToCloseTimeout: "1 minute",
  scheduleToCloseTimeout: "30 minutes",
  retry: {
    initialInterval: "15 seconds",
    backoffCoefficient: 1.5,
    maximumInterval: "2 minutes",
  },
});

/** A vote's start: as the judge's, ten minutes of capacity retries; a cancel waits as the try's start does. */
const voteStart = proxyActivities<CaseActivities>({
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  startToCloseTimeout: "1 minute",
  scheduleToCloseTimeout: "10 minutes",
  retry: {
    initialInterval: "15 seconds",
    backoffCoefficient: 1.5,
    maximumInterval: "1 minute",
  },
});

/** How long a vote may run before it is stopped and counted as failed. */
const VOTE_BUDGET_MS = 10 * 60 * 1000;

/**
 * How long a try's run may wait for a runner before it is stopped, not
 * graded, "platform busy": the try start's own thirty minutes of capacity
 * retries.
 */
const CAPACITY_WAIT_MS = 30 * 60 * 1000;

/** How long a stopped try is waited for before it is graded anyway. */
const STOP_GRACE_MS = 2 * 60 * 1000;

/** The poll's first wait and step, its cap, and a vote's cap (the module header's history). */
const POLL_FIRST_MS = 3_000;
const POLL_CAP_MS = 15_000;
const VOTE_POLL_CAP_MS = 60_000;

/** The votes each AI-graded check takes (graders/llm.ts VOTES_PER_CHECK). */
const VOTES_PER_CHECK = 3;

/** What the workflow knows of the try's runs, for a cancel to stop and count them. */
interface Known {
  sessionId: string;
  runId: string;
  /** The vote whose run is going, if one is. */
  voteRunId: string;
  /** What the votes already read spent: their sessions, and so their runs, are deleted. */
  voteCostUsd: number;
  /**
   * What the votes read whose session could not be deleted spent: their
   * runs are still stored, so a spend read counts them, never this too.
   */
  keptVoteCostUsd: number;
}

export async function runCase(input: CaseInput): Promise<TryResult> {
  const known: Known = {
    sessionId: "",
    runId: "",
    voteRunId: "",
    voteCostUsd: 0,
    keptVoteCostUsd: 0,
  };
  try {
    return await runTry(input, known);
  } catch (error) {
    if (isCancellation(error)) {
      return await CancellationScope.nonCancellable(() =>
        cancelledTry(input, known),
      );
    }
    await CancellationScope.nonCancellable(() => stopKnownRuns(known));
    if (error instanceof TemporalFailure) {
      throw error;
    }
    const details: CaseFailureDetails = { voteCostUsd: known.voteCostUsd };
    throw ApplicationFailure.create({
      message: error instanceof Error ? error.message : String(error),
      type: PLUGIN_EVAL_CASE_FAILED_FAILURE_TYPE,
      nonRetryable: true,
      details: [details],
    });
  }
}

async function runTry(input: CaseInput, known: Known): Promise<TryResult> {
  let started;
  try {
    started = await tryStart[START_TRY_ACTIVITY_NAME](input);
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
    // An earlier attempt of the start may have created the run.
    return spentNotGraded(
      input,
      isBusy(error) ? PLATFORM_BUSY_REASON : TRY_NOT_STARTED_REASON,
    );
  }
  if (started.kind === "refused") {
    switch (started.failure) {
      case "out-of-credit":
        return {
          ...notGraded("", "", OUT_OF_CREDIT_REASON),
          outOfCredit: true,
        };
      case "cannot-act":
        return notGraded(
          "",
          "",
          started.reason === "" ? CANNOT_ACT_REASON : started.reason,
        );
      case "not-started":
        return notGraded("", "", started.reason);
      /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
      default: {
        const exhausted: never = started.failure;
        return exhausted;
      }
    }
  }

  const { sessionId, runId } = started;
  known.sessionId = sessionId;
  known.runId = runId;
  const waited = await awaitTry(runId, input.timeoutSeconds * 1000);
  if (waited === "never-started") {
    try {
      await steps[STOP_RUN_ACTIVITY_NAME](runId, NEVER_STARTED_STOP_REASON);
    } catch (error) {
      if (isCancellation(error)) {
        throw error;
      }
      return await spentNotGraded(input, TRY_NOT_STOPPED_REASON, {
        sessionId,
        runId,
      });
    }
    await awaitRun(runId, STOP_GRACE_MS);
    return await spentNotGraded(input, PLATFORM_BUSY_REASON, {
      sessionId,
      runId,
    });
  }
  const timedOut = waited === "timed-out";
  if (timedOut) {
    try {
      await steps[STOP_RUN_ACTIVITY_NAME](
        runId,
        `timed out after ${input.timeoutSeconds}s`,
      );
    } catch (error) {
      if (isCancellation(error)) {
        throw error;
      }
      return await spentNotGraded(input, TRY_NOT_STOPPED_REASON, {
        sessionId,
        runId,
      });
    }
    await awaitRun(runId, STOP_GRACE_MS);
  }

  let grade: TryGrade;
  try {
    grade = await grading[GRADE_TRY_ACTIVITY_NAME](input, runId, timedOut);
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
    return spentNotGraded(input, GRADING_FAILED_REASON, { sessionId, runId });
  }

  const votes: Array<ReadonlyArray<VoteRead["vote"]>> = [];
  for (const [graderIndex, outcome] of grade.outcomes.entries()) {
    const cast: VoteRead["vote"][] = [];
    if ("votes" in outcome) {
      for (let voteIndex = 0; voteIndex < VOTES_PER_CHECK; voteIndex++) {
        const read = await vote(
          input,
          known,
          graderIndex,
          voteIndex,
          outcome.votes,
        );
        if (read === undefined) {
          return unreadVoteTry(input, known, grade);
        }
        cast.push(read.vote);
      }
    }
    votes.push(cast);
  }

  const graded: TryGrade = {
    ...grade,
    costUsd: grade.costUsd + known.voteCostUsd + known.keptVoteCostUsd,
  };
  try {
    return await grading[RECORD_SCORE_ACTIVITY_NAME](
      input,
      { sessionId, runId },
      graded,
      votes,
    );
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

/**
 * One vote: start, wait within its budget, read (graders/llm.ts), delete
 * its session, its cost added to `known`'s tally of deleted votes, or of
 * kept ones when the delete fails past its retries. Undefined when the
 * read fails past its retries; the vote's run is then stopped and left in
 * `known.voteRunId`, its spend still stored.
 */
async function vote(
  input: CaseInput,
  known: Known,
  graderIndex: number,
  voteIndex: number,
  rubric: string,
): Promise<VoteRead | undefined> {
  let start;
  try {
    start = await voteStart[START_VOTE_ACTIVITY_NAME](
      input,
      known.runId,
      graderIndex,
      voteIndex,
    );
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
    return {
      vote: {
        kind: "failed",
        reason: isBusy(error)
          ? PLATFORM_BUSY_REASON
          : "the judge could not start",
      },
      costUsd: 0,
    };
  }
  if (start.kind === "failed") {
    return { vote: { kind: "failed", reason: start.reason }, costUsd: 0 };
  }
  known.voteRunId = start.voteRunId;
  await awaitRun(start.voteRunId, VOTE_BUDGET_MS, VOTE_POLL_CAP_MS);
  let read: VoteRead;
  try {
    read = await steps[READ_VOTE_ACTIVITY_NAME](start.voteRunId, rubric);
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
    await stopQuietly(start.voteRunId, UNREAD_VOTE_STOP_REASON);
    await awaitRun(start.voteRunId, STOP_GRACE_MS);
    return undefined;
  }
  try {
    await steps[DELETE_VOTE_ACTIVITY_NAME](start.voteRunId);
    known.voteCostUsd += read.costUsd;
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
    // The session, and so the vote's run, is left: a spend read counts it.
    known.keptVoteCostUsd += read.costUsd;
  }
  known.voteRunId = "";
  return read;
}

/** The reason an unread vote's run is stopped with. */
const UNREAD_VOTE_STOP_REASON = "the vote could not be read";

/**
 * The try whose vote could not be read (the module header): not graded,
 * with what the try's run and every vote spent. The spend activity reads
 * the try's run and the votes still stored, the unread one and any whose
 * delete failed included; the votes deleted are the workflow's own tally.
 * A spend read that fails falls back to the grade's cost and the votes
 * kept.
 */
async function unreadVoteTry(
  input: CaseInput,
  known: Known,
  grade: TryGrade,
): Promise<TryResult> {
  const stored =
    (await spendOf(input))?.costUsd ?? grade.costUsd + known.keptVoteCostUsd;
  return {
    ...notGraded(known.sessionId, known.runId, VOTE_NOT_READ_REASON),
    error: grade.error,
    costUsd: stored + known.voteCostUsd,
    durationSeconds: grade.durationSeconds,
  };
}

/** The reason a cancel gives the runs it stops. */
const CANCELLED_STOP_REASON = "the eval was cancelled";

/**
 * The try the eval's cancel ended (the module header), run in a
 * non-cancellable scope: the vote's run and the try's stopped, the try's
 * found by the spend activity when the start's answer was lost, and what
 * they spent read once the try's run has ended. A stop or a read that
 * fails leaves the try answered with what is known.
 */
async function cancelledTry(input: CaseInput, known: Known): Promise<TryResult> {
  if (known.voteRunId !== "") {
    await stopQuietly(known.voteRunId);
  }
  let { sessionId, runId } = known;
  if (runId === "") {
    const found = await spendOf(input);
    if (found !== undefined) {
      ({ sessionId, runId } = found);
    }
  }
  let costUsd = 0;
  if (runId !== "") {
    await stopQuietly(runId);
    await awaitRun(runId, STOP_GRACE_MS);
    costUsd = (await spendOf(input))?.costUsd ?? known.keptVoteCostUsd;
  }
  return {
    ...notGraded(sessionId, runId, TRY_CANCELLED_REASON),
    costUsd: costUsd + known.voteCostUsd,
  };
}

/** The reason a try's run that no runner took in time is stopped with. */
const NEVER_STARTED_STOP_REASON = "no runner took the try in time";

/** The reason a failed try workflow stops the runs it knows with. */
const FAILED_STOP_REASON = "the try's workflow failed";

/** Stops the try's run and any vote's run going, before the workflow fails; a stop that fails is left to the run's cap. */
async function stopKnownRuns(known: Known): Promise<void> {
  if (known.voteRunId !== "") {
    await stopQuietly(known.voteRunId, FAILED_STOP_REASON);
  }
  if (known.runId !== "") {
    await stopQuietly(known.runId, FAILED_STOP_REASON);
  }
}

/** Stops `runId` (for the cancel, by default); a stop that fails leaves the run to its own cap. */
async function stopQuietly(
  runId: string,
  reason: string = CANCELLED_STOP_REASON,
): Promise<void> {
  try {
    await steps[STOP_RUN_ACTIVITY_NAME](runId, reason);
  } catch {
    // The run keeps its spending cap; the try is answered either way.
  }
}

/** The try's run and its spend as the spend activity finds them; undefined when none is found or the read fails. */
async function spendOf(input: CaseInput): Promise<TrySpend | undefined> {
  try {
    const found = await steps[TRY_SPEND_ACTIVITY_NAME](input.evalId, {
      caseIndex: input.caseIndex,
      targetIndex: input.targetIndex,
      arm: input.arm,
      tryIndex: input.tryIndex,
    });
    return found.runId === "" ? undefined : found;
  } catch {
    return undefined;
  }
}

/** Polls `runId` until it ends (true) or `budgetMs` pass (false), the wait between polls growing to `capMs`. */
async function awaitRun(
  runId: string,
  budgetMs: number,
  capMs: number = POLL_CAP_MS,
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  let wait = POLL_FIRST_MS;
  for (;;) {
    await sleep(Math.max(1, Math.min(wait, deadline - Date.now())));
    if ((await poll(runId))?.phase === "ended") {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    wait = Math.min(wait + POLL_FIRST_MS, capMs);
  }
}

/**
 * Polls the try's run (the module header's wait): ended; timed out, its
 * `timeoutMs` counted from when it started; or never started, still
 * pending when the capacity wait ran out. A poll that fails tells nothing,
 * so the run counts as pending until one reads it out of pending.
 */
async function awaitTry(
  runId: string,
  timeoutMs: number,
): Promise<"ended" | "timed-out" | "never-started"> {
  const begun = Date.now();
  let deadline = begun + CAPACITY_WAIT_MS;
  let started = false;
  let wait = POLL_FIRST_MS;
  for (;;) {
    await sleep(Math.max(1, Math.min(wait, deadline - Date.now())));
    const read = await poll(runId);
    if (read?.phase === "ended") {
      return "ended";
    }
    if (!started && read?.phase === "running") {
      started = true;
      // The run's own stamp, within when this workflow waited, since the
      // server's clock and the workflow's may differ.
      const from =
        read.startedAtMs > 0
          ? Math.min(Math.max(read.startedAtMs, begun), Date.now())
          : Date.now();
      deadline = from + timeoutMs;
    }
    if (Date.now() >= deadline) {
      return started ? "timed-out" : "never-started";
    }
    wait = Math.min(wait + POLL_FIRST_MS, POLL_CAP_MS);
  }
}

/** One poll of `runId`; undefined when it fails past its retries. */
async function poll(runId: string): Promise<RunPoll | undefined> {
  try {
    return await steps[POLL_RUN_ACTIVITY_NAME](runId);
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
    return undefined;
  }
}

/**
 * A try not graded for `reason` whose run may have spent: its session, run
 * and cost as the spend activity finds them. Nothing found, or a read that
 * fails, is no spend, and keeps the ids the workflow already knows.
 */
async function spentNotGraded(
  input: CaseInput,
  reason: string,
  known: { readonly sessionId: string; readonly runId: string } = {
    sessionId: "",
    runId: "",
  },
): Promise<TryResult> {
  let spend = { ...known, costUsd: 0 };
  try {
    const found = await steps[TRY_SPEND_ACTIVITY_NAME](input.evalId, {
      caseIndex: input.caseIndex,
      targetIndex: input.targetIndex,
      arm: input.arm,
      tryIndex: input.tryIndex,
    });
    if (found.runId !== "") {
      spend = found;
    }
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
  }
  return {
    ...notGraded(spend.sessionId, spend.runId, reason),
    costUsd: spend.costUsd,
  };
}

function notGraded(
  sessionId: string,
  runId: string,
  reason: string,
): TryResult {
  return {
    sessionId,
    runId,
    state: "not-graded",
    score: 0,
    notGradedReason: reason,
    error: "",
    costUsd: 0,
    durationSeconds: 0,
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
    if (
      cause instanceof ApplicationFailure &&
      cause.type === PLUGIN_EVAL_BUSY_FAILURE_TYPE
    ) {
      return true;
    }
    cause = cause.cause;
  }
  return false;
}

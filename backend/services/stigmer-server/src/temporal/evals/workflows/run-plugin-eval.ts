/**
 * One plugin eval, run whole: plan the suite, run every try as a child
 * workflow, fold each result into the eval's status, end.
 *
 *   - Plan: the load reads the eval and its suite at the stamped digest,
 *     plans the matrix and writes the status skeleton (every case, target
 *     and try, each not-run reason), the phase running. An eval that is
 *     gone, failed to load, or already ended plans nothing.
 *   - Run: each cell is a child `stigmer/evals/run-case` under its own id
 *     (`runCaseWorkflowId`), at most `concurrency` in flight, in the
 *     matrix's order. A child per try keeps this history at a few events
 *     per try, where polling every try here would grow it with every poll.
 *   - Record: after each child, an activity folds its result into the
 *     status and recomputes the scores: this workflow is the status's one
 *     writer, so no two writes race. The record takes the result without
 *     its grader results, which it never reads, so this history carries
 *     them once.
 *   - Spend: before each cell starts, the cost of the finished tries and
 *     their votes, plus the caps the tries still running hold, is compared
 *     with the eval's limit. While they reach it no cell starts; a running
 *     try that finishes under its cap frees the rest of it, and once the
 *     finished tries alone reach the limit with none running the eval ends
 *     partial, "cost ceiling". Each try's run is capped, when it starts, at
 *     an equal share of what the eval has left for the tries that may run
 *     at once: (limit less recorded spend) / concurrency, and never more
 *     than the limit less the recorded spend and the caps held
 *     (tryBudgetUsd), so no try starts with a sliver while another holds
 *     the rest. While something is left the cap is never below
 *     TRY_MIN_BUDGET_USD (a cap of 0 is no cap), so the last tries can
 *     pass the limit by that floor. An AI-graded check's votes are not
 *     under the try's cap: each vote is capped at the judge's own $0.25.
 *     So tries already running and their AI-graded checks finish, and the
 *     spend can pass the limit by those.
 *   - Credit: a try the organization's credit refused stops new cells the
 *     same way, and the eval ends partial, "out of credit".
 *   - Cancel: cancelling this workflow (the eval's cancel) cancels the
 *     children in flight, each of which stops its run and answers its try
 *     not graded, "cancelled", with what the run spent. Each is recorded
 *     in a non-cancellable scope (a child that ends without its answer is
 *     recorded the same way, its spend read by the spend activity), so the
 *     eval's cost counts it and no try in flight stays pending; no cell
 *     starts after the cancel, and the eval ends partial, "cancelled".
 *   - A child that fails outright is recorded as a try not graded, never
 *     the eval's failure, with what its run spent read by the spend
 *     activity (the try's run by the eval's label and its name), so the
 *     ceiling counts it.
 *   - A load or a record that fails past its retries ends the eval failed
 *     with the reason, through the finish, once the tries in flight have
 *     settled: the workflow never ends leaving the eval running.
 *
 * WORKFLOW-BUNDLE IMPORT DISCIPLINE: this module runs in the deterministic
 * sandbox; imports are limited to @temporalio/workflow and the pure names
 * module.
 */
import {
  ActivityFailure,
  CancellationScope,
  CancelledFailure,
  ParentClosePolicy,
  executeChild,
  isCancellation,
  proxyActivities,
} from "@temporalio/workflow";

import {
  EVAL_NOT_PLANNED_ERROR,
  FINISH_EVAL_ACTIVITY_NAME,
  LOAD_SUITE_ACTIVITY_NAME,
  RECORD_TRY_ACTIVITY_NAME,
  RUN_CASE_WORKFLOW_TYPE,
  TRY_CANCELLED_REASON,
  TRY_FAILED_REASON,
  TRY_MIN_BUDGET_USD,
  TRY_NOT_RECORDED_ERROR,
  TRY_SPEND_ACTIVITY_NAME,
  runCaseWorkflowId,
} from "../names.js";
import type {
  CaseInput,
  RecordedTry,
  RunPluginEvalInput,
  SpendActivities,
  SuiteActivities,
  SuiteCell,
  SuiteStop,
  TryResult,
} from "../names.js";

/** The load, the record and the spend read: store work and one archive read, retried. */
const steps = proxyActivities<SuiteActivities & SpendActivities>({
  startToCloseTimeout: "5 minutes",
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
    maximumAttempts: 10,
  },
});

/**
 * The finish, retried for up to twenty minutes so a store outage does not
 * leave the eval running for ever.
 */
const finishing = proxyActivities<SuiteActivities>({
  startToCloseTimeout: "1 minute",
  scheduleToCloseTimeout: "20 minutes",
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
  },
});

/**
 * What counts as nothing left, in dollars: sums of cents in floating point
 * leave a remainder far below any run's metering (0.05 - 0.02 - 0.03 is
 * not 0), which must not start a try.
 */
const SPEND_EPSILON_USD = 1e-9;

/** The longest cause a failed eval's error quotes. */
const CAUSE_MAX_LENGTH = 500;

/** One of this workflow's own steps that could not be done: the eval ends failed with its message. */
class StepFailed extends Error {}

/** `error` from a step past its retries as StepFailed, naming `what` and the cause. */
function stepFailed(what: string, error: unknown): StepFailed {
  const cause =
    error instanceof ActivityFailure && error.cause !== undefined
      ? error.cause.message
      : error instanceof Error
        ? error.message
        : String(error);
  return new StepFailed(
    cause === "" ? what : `${what}: ${cause.slice(0, CAUSE_MAX_LENGTH)}`,
  );
}

export async function runPluginEval(input: RunPluginEvalInput): Promise<void> {
  const { evalId } = input;
  try {
    let plan;
    try {
      plan = await steps[LOAD_SUITE_ACTIVITY_NAME](evalId);
    } catch (error) {
      throw isCancellation(error) ? error : stepFailed(EVAL_NOT_PLANNED_ERROR, error);
    }
    if (plan.kind === "stop") {
      return;
    }
    const stop = await runCells(
      evalId,
      plan.org,
      plan.cells,
      plan.maxCostUsd,
      Math.max(1, plan.concurrency),
    );
    await finishing[FINISH_EVAL_ACTIVITY_NAME](
      evalId,
      stop === undefined
        ? { phase: "completed" }
        : { phase: "partial", reason: stop },
    );
  } catch (error) {
    if (isCancellation(error)) {
      await CancellationScope.nonCancellable(() =>
        finishing[FINISH_EVAL_ACTIVITY_NAME](evalId, {
          phase: "partial",
          reason: "cancelled",
        }),
      );
      throw error;
    }
    if (error instanceof StepFailed) {
      // The eval's failure is its status; this workflow has done its job.
      await finishing[FINISH_EVAL_ACTIVITY_NAME](evalId, {
        phase: "failed",
        error: error.message,
      });
      return;
    }
    throw error;
  }
}

/**
 * Runs the cells, at most `concurrency` at once, until all ran or a stop;
 * answers why it stopped early, if it did. Rethrows a cancellation, or a
 * record that failed, once the cells in flight have settled.
 */
async function runCells(
  evalId: string,
  org: string,
  cells: ReadonlyArray<SuiteCell>,
  maxCostUsd: number,
  concurrency: number,
): Promise<SuiteStop | undefined> {
  let spent = 0;
  let stop: SuiteStop | undefined;
  let rejected: unknown;
  let next = 0;
  const inFlight = new Map<number, Promise<void>>();
  /** The cap each try in flight was handed, by cell index. */
  const caps = new Map<number, number>();
  const scope = CancellationScope.current();

  for (;;) {
    while (
      rejected === undefined &&
      stop === undefined &&
      !scope.consideredCancelled &&
      next < cells.length &&
      inFlight.size < concurrency
    ) {
      let held = 0;
      for (const cap of caps.values()) {
        held += cap;
      }
      const budgetUsd = tryBudgetUsd(maxCostUsd, spent, held, concurrency);
      if (budgetUsd === 0) {
        // Nothing is left beyond the caps held: wait for a running try to
        // free its cap, or, with none running, the limit is reached.
        if (inFlight.size === 0) {
          stop = "cost_ceiling";
        }
        break;
      }
      const index = next++;
      const cell = cells[index]!;
      caps.set(index, budgetUsd);
      const settled = runCell(evalId, org, cell, budgetUsd).then(
        (result) => {
          inFlight.delete(index);
          caps.delete(index);
          spent += result.costUsd;
          if (result.outOfCredit && stop === undefined) {
            stop = "out_of_credit";
          }
        },
        (error: unknown) => {
          inFlight.delete(index);
          caps.delete(index);
          rejected ??= error;
        },
      );
      inFlight.set(index, settled);
    }
    if (inFlight.size === 0) {
      break;
    }
    await Promise.race(inFlight.values());
  }
  if (rejected !== undefined) {
    throw rejected;
  }
  if (scope.consideredCancelled) {
    // Every child answered its cancel with a result, now recorded.
    throw new CancelledFailure("the eval was cancelled");
  }
  return stop;
}

/**
 * One cell: its child, then the fold of its result. Rejects only on
 * cancellation, after recording the try cancelled, or with StepFailed
 * when the record fails past its retries.
 */
async function runCell(
  evalId: string,
  org: string,
  cell: SuiteCell,
  budgetUsd: number,
): Promise<TryResult> {
  const caseInput: CaseInput = { ...cell, evalId, org, budgetUsd };
  let result: TryResult;
  let cancellation: unknown;
  try {
    result = await executeChild(RUN_CASE_WORKFLOW_TYPE, {
      workflowId: runCaseWorkflowId(
        evalId,
        cell.caseIndex,
        cell.targetIndex,
        cell.arm,
        cell.tryIndex,
      ),
      args: [caseInput],
      parentClosePolicy: ParentClosePolicy.TERMINATE,
    });
  } catch (error) {
    if (isCancellation(error)) {
      // The child ended without its answer: the try is recorded cancelled.
      cancellation = error;
      result = await CancellationScope.nonCancellable(() =>
        failedTry(evalId, cell, TRY_CANCELLED_REASON),
      );
    } else {
      result = await failedTry(evalId, cell, TRY_FAILED_REASON);
    }
  }
  const { graderResults: _unread, ...recorded } = result;
  const record: RecordedTry = recorded;
  let recordFailure: StepFailed | undefined;
  try {
    // A finished try is recorded even when the eval is being cancelled.
    await CancellationScope.nonCancellable(() =>
      steps[RECORD_TRY_ACTIVITY_NAME](evalId, cell, record),
    );
  } catch (error) {
    recordFailure = stepFailed(TRY_NOT_RECORDED_ERROR, error);
  }
  if (cancellation !== undefined) {
    throw cancellation;
  }
  if (recordFailure !== undefined) {
    throw recordFailure;
  }
  return result;
}

/** A try whose child ended without its answer: not graded for `reason`, with what its run spent, if one is found. */
async function failedTry(
  evalId: string,
  cell: SuiteCell,
  reason: string,
): Promise<TryResult> {
  let spend = { sessionId: "", runId: "", costUsd: 0 };
  try {
    spend = await steps[TRY_SPEND_ACTIVITY_NAME](evalId, {
      caseIndex: cell.caseIndex,
      targetIndex: cell.targetIndex,
      arm: cell.arm,
      tryIndex: cell.tryIndex,
    });
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
  }
  return {
    sessionId: spend.sessionId,
    runId: spend.runId,
    state: "not-graded",
    score: 0,
    notGradedReason: reason,
    error: "",
    costUsd: spend.costUsd,
    durationSeconds: 0,
    graderResults: [],
    outOfCredit: false,
  };
}

/**
 * A try's run cap: an equal share of what the eval has left for the
 * `concurrency` tries that may run at once, bounded by what the caps
 * already handed out leave, never below the floor while something is
 * left; 0, start nothing, once the recorded spend and the caps held reach
 * the limit (the module header).
 */
export function tryBudgetUsd(maxCostUsd: number, spent: number, held: number, concurrency: number): number {
  const left = maxCostUsd - spent;
  const free = left - held;
  if (free <= SPEND_EPSILON_USD) {
    return 0;
  }
  const share = left / Math.max(1, concurrency);
  return Math.max(TRY_MIN_BUDGET_USD, Math.min(share, free));
}

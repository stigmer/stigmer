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
 *     writer, so no two writes race.
 *   - Spend: before each cell starts, the cost of the finished tries and
 *     their votes is compared with the eval's limit; once it is reached no
 *     cell starts, the tries already running finish (so the spend can pass
 *     the limit by those, as in the format), and the eval ends partial,
 *     "cost ceiling".
 *   - Credit: a try the organization's credit refused stops new cells the
 *     same way, and the eval ends partial, "out of credit".
 *   - Cancel: cancelling this workflow (the eval's cancel) cancels the
 *     children in flight, each of which stops its run, and the eval ends
 *     partial, "cancelled".
 *   - A child that fails outright is recorded as a try not graded, never
 *     the eval's failure.
 *
 * WORKFLOW-BUNDLE IMPORT DISCIPLINE: this module runs in the deterministic
 * sandbox; imports are limited to @temporalio/workflow and the pure names
 * module.
 */
import {
  CancellationScope,
  ParentClosePolicy,
  executeChild,
  isCancellation,
  proxyActivities,
} from "@temporalio/workflow";

import {
  FINISH_EVAL_ACTIVITY_NAME,
  LOAD_SUITE_ACTIVITY_NAME,
  RECORD_TRY_ACTIVITY_NAME,
  RUN_CASE_WORKFLOW_TYPE,
  TRY_FAILED_REASON,
  runCaseWorkflowId,
} from "../names.js";
import type {
  CaseInput,
  RunPluginEvalInput,
  SuiteActivities,
  SuiteCell,
  SuiteStop,
  TryResult,
} from "../names.js";

/** The load and the record: store work and one archive read, retried. */
const steps = proxyActivities<SuiteActivities>({
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

export async function runPluginEval(input: RunPluginEvalInput): Promise<void> {
  const { evalId } = input;
  try {
    const plan = await steps[LOAD_SUITE_ACTIVITY_NAME](evalId);
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
    }
    throw error;
  }
}

/**
 * Runs the cells, at most `concurrency` at once, until all ran or a stop;
 * answers why it stopped early, if it did. Rethrows a cancellation once
 * the cells in flight have settled.
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
  let cancelled: unknown;
  let next = 0;
  const inFlight = new Map<number, Promise<void>>();

  for (;;) {
    while (
      cancelled === undefined &&
      stop === undefined &&
      next < cells.length &&
      inFlight.size < concurrency
    ) {
      if (spent >= maxCostUsd) {
        stop = "cost_ceiling";
        break;
      }
      const index = next++;
      const cell = cells[index];
      if (cell === undefined) {
        continue;
      }
      const settled = runCell(evalId, org, cell).then(
        (result) => {
          inFlight.delete(index);
          spent += result.costUsd;
          if (result.outOfCredit && stop === undefined) {
            stop = "out_of_credit";
          }
        },
        (error: unknown) => {
          inFlight.delete(index);
          cancelled ??= error;
        },
      );
      inFlight.set(index, settled);
    }
    if (inFlight.size === 0) {
      break;
    }
    await Promise.race(inFlight.values());
  }
  if (cancelled !== undefined) {
    throw cancelled;
  }
  return stop;
}

/** One cell: its child, then the fold of its result. Rejects only on cancellation. */
async function runCell(
  evalId: string,
  org: string,
  cell: SuiteCell,
): Promise<TryResult> {
  const caseInput: CaseInput = { ...cell, evalId, org };
  let result: TryResult;
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
      throw error;
    }
    result = {
      sessionId: "",
      runId: "",
      state: "not-graded",
      score: 0,
      notGradedReason: TRY_FAILED_REASON,
      error: "",
      costUsd: 0,
      durationSeconds: 0,
      graderResults: [],
      outOfCredit: false,
    };
  }
  // A finished try is recorded even when the eval is being cancelled.
  await CancellationScope.nonCancellable(() =>
    steps[RECORD_TRY_ACTIVITY_NAME](evalId, cell, result),
  );
  return result;
}

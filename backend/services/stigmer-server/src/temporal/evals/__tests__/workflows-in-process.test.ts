/**
 * Pins the two eval workflows' bodies in-process, so coverage measures the
 * bodies they run: workflows.temporal.test.ts drives the main scenarios
 * through a TestWorkflowEnvironment, where the bodies run in the worker's
 * bundle, which V8 coverage never maps back to the modules (the grading
 * workflow's precedent, grade-run-in-process.test.ts).
 *
 * The workflow SDK's activity proxy, its child start and its sleep are
 * replaced at the module seam and answer from a script.
 *
 * The suite: every cell run and recorded, at most `concurrency` children
 * in flight; the cost ceiling checked before
 * each cell, each child capped at an equal share of what is left for the
 * children that may run at once, within what the running caps leave (never
 * below the floor); a credit refusal
 * stopping new cells; a child that fails recorded as not graded with what
 * its run spent, which the ceiling counts, even when the eval's cancel
 * lands during that spend read; a cancellation recording every
 * child in flight (its own cancelled answer, or one read through the spend
 * activity), starting no cell after, ending the eval partial "cancelled"
 * and rethrown;
 * a load or a record failing past its retries ending the eval failed with
 * the reason, that end written even when a cancel lands during it, and the
 * finish retried with no bound of its own; any other error, the finish's
 * own included, ending the eval failed as far as the finish can and
 * failing the workflow as a non-retryable ApplicationFailure; an eval
 * planning nothing ending at once.
 *
 * The case: start, wait, grade, three votes per AI-graded check, record;
 * the deadline stopping the run and grading what it produced; each start
 * refusal answered (credit, cannot act, the run's own, busy past the
 * retries, busy found deeper in the failure's causes, any other failure
 * as not started); an unexpected error of the workflow's own failed as a
 * non-retryable ApplicationFailure, a Temporal failure of its own as is;
 * every grading and steps proxy waiting for its cancellation to complete; a cancellation anywhere (the start, the wait, the
 * grade, a vote, the record, the deadline's stop, the spend read)
 * stopping the try's run and any vote's run, the run found by the spend
 * activity when the start's answer is unknown, and answered as a try not
 * graded, "cancelled", with its ids and what it spent; a grade, a stop or
 * a start that fails leaving the try not graded with what its run spent;
 * a vote that cannot start counted as failed; a vote that cannot be read
 * past its retries stopped, the try not graded with what its run and every
 * vote spent; each read vote's session deleted after its read, a delete
 * that fails past its retries leaving the vote counted once, by the
 * workflow on a graded try and by the spend read, which still holds its
 * run, on any other, a cancellation at the delete counting that vote
 * once, through the spend read.
 */
import {
  ActivityCancellationType,
  ActivityFailure,
  ApplicationFailure,
  CancelledFailure,
} from "@temporalio/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CANNOT_ACT_REASON,
  DELETE_VOTE_ACTIVITY_NAME,
  FINISH_EVAL_ACTIVITY_NAME,
  GRADE_TRY_ACTIVITY_NAME,
  GRADING_FAILED_REASON,
  LOAD_SUITE_ACTIVITY_NAME,
  OUT_OF_CREDIT_REASON,
  PLATFORM_BUSY_REASON,
  PLUGIN_EVAL_BUSY_FAILURE_TYPE,
  PLUGIN_EVAL_CASE_FAILED_FAILURE_TYPE,
  POLL_RUN_ACTIVITY_NAME,
  READ_VOTE_ACTIVITY_NAME,
  RECORD_SCORE_ACTIVITY_NAME,
  RECORD_TRY_ACTIVITY_NAME,
  RUN_CASE_WORKFLOW_TYPE,
  START_TRY_ACTIVITY_NAME,
  START_VOTE_ACTIVITY_NAME,
  STOP_RUN_ACTIVITY_NAME,
  EVAL_NOT_PLANNED_ERROR,
  EVAL_WORKFLOW_FAILED_ERROR,
  PLUGIN_EVAL_SUITE_FAILED_FAILURE_TYPE,
  TRY_FAILED_REASON,
  TRY_MIN_BUDGET_USD,
  TRY_NOT_RECORDED_ERROR,
  TRY_NOT_STARTED_REASON,
  TRY_NOT_STOPPED_REASON,
  TRY_CANCELLED_REASON,
  TRY_SPEND_ACTIVITY_NAME,
  VOTE_NOT_READ_REASON,
} from "../names.js";
import type {
  CaseInput,
  RunPoll,
  SuiteCell,
  TryGrade,
  TryResult,
  TrySpend,
} from "../names.js";

const seam = vi.hoisted(() => ({
  activities: {} as Record<string, ReturnType<typeof vi.fn>>,
  /** Whether the workflow's scope has been cancelled. */
  cancelled: false,
  /** How many non-cancellable scopes are open, for an activity to tell whether a cancel reaches it. */
  shielded: 0,
  /** Every activity proxy's options, as the workflow modules declared them at load. */
  proxies: [] as unknown[],
  child: (() => Promise.reject(new Error("no child expected"))) as (
    type: string,
    options: { workflowId: string; args: unknown[] },
  ) => Promise<unknown>,
}));

vi.mock("@temporalio/workflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@temporalio/workflow")>();
  return {
    ...actual,
    proxyActivities: (options: unknown) => {
      seam.proxies.push(options);
      return new Proxy({}, { get: (_target, name: string) => seam.activities[name] });
    },
    executeChild: (
      type: string,
      options: { workflowId: string; args: unknown[] },
    ) => seam.child(type, options),
    CancellationScope: {
      nonCancellable: async <T>(fn: () => Promise<T>) => {
        seam.shielded++;
        try {
          return await fn();
        } finally {
          seam.shielded--;
        }
      },
      current: () => ({
        get consideredCancelled() {
          return seam.cancelled;
        },
      }),
    },
    sleep: (ms: number) => {
      vi.setSystemTime(Date.now() + ms);
      return Promise.resolve();
    },
  };
});

const { runPluginEval, tryBudgetUsd } = await import(
  "../workflows/run-plugin-eval.js"
);
const { runCase } = await import("../workflows/run-case.js");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  seam.activities = {};
  seam.cancelled = false;
  seam.shielded = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

function result(overrides: Partial<TryResult> = {}): TryResult {
  return {
    sessionId: "ses_1",
    runId: "run_1",
    state: "graded",
    score: 1,
    notGradedReason: "",
    error: "",
    costUsd: 0.1,
    durationSeconds: 1,
    outOfCredit: false,
    ...overrides,
  };
}

function cells(count: number): SuiteCell[] {
  return Array.from({ length: count }, (_, tryIndex) => ({
    caseIndex: 0,
    targetIndex: 0,
    arm: "with" as const,
    tryIndex,
    timeoutSeconds: 60,
  }));
}

const NO_SPEND: TrySpend = { sessionId: "", runId: "", costUsd: 0 };

function suite(plan: unknown, spend: TrySpend = NO_SPEND) {
  const recorded: Array<{ cell: SuiteCell; result: TryResult }> = [];
  const finished: unknown[] = [];
  seam.activities = {
    [LOAD_SUITE_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(plan)),
    [RECORD_TRY_ACTIVITY_NAME]: vi.fn(
      (_id: string, cell: SuiteCell, outcome: TryResult) => {
        recorded.push({ cell, result: outcome });
        return Promise.resolve();
      },
    ),
    [FINISH_EVAL_ACTIVITY_NAME]: vi.fn((_id: string, end: unknown) => {
      finished.push(end);
      return Promise.resolve();
    }),
    [TRY_SPEND_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(spend)),
  };
  return { recorded, finished };
}

/** A step past its retries, as the activity proxy reports it. */
function stepFailure(activity: string, message: string): ActivityFailure {
  return new ActivityFailure(
    "activity failed",
    activity,
    "1",
    undefined,
    "worker",
    ApplicationFailure.create({ message, type: "Error" }),
  );
}

describe("the suite workflow", () => {
  it("runs every cell as a child, at most concurrency at once, and ends completed", async () => {
    const { recorded, finished } = suite({
      kind: "run",
      org: "acme",
      cells: cells(5),
      maxCostUsd: 10,
      concurrency: 2,
    });
    let inFlight = 0;
    let most = 0;
    const ids: string[] = [];
    seam.child = async (type, options) => {
      expect(type).toBe(RUN_CASE_WORKFLOW_TYPE);
      ids.push(options.workflowId);
      inFlight++;
      most = Math.max(most, inFlight);
      await Promise.resolve();
      await Promise.resolve();
      inFlight--;
      return result();
    };
    await runPluginEval({ evalId: "pev_1" });
    expect(most).toBe(2);
    expect(ids[0]).toBe("plugin-eval/pev_1/0/0/with/0");
    expect(recorded).toHaveLength(5);
    expect(finished).toEqual([{ phase: "completed" }]);
  });

  it("starts no cell once the finished tries reach the spending limit", async () => {
    const { recorded, finished } = suite({
      kind: "run",
      org: "acme",
      cells: cells(5),
      maxCostUsd: 0.25,
      concurrency: 1,
    });
    seam.child = async () => result({ costUsd: 0.1 });
    await runPluginEval({ evalId: "pev_1" });
    expect(recorded).toHaveLength(3);
    expect(finished).toEqual([{ phase: "partial", reason: "cost_ceiling" }]);
  });

  it("stops new cells when the organization's credit refuses a try", async () => {
    const { recorded, finished } = suite({
      kind: "run",
      org: "acme",
      cells: cells(4),
      maxCostUsd: 10,
      concurrency: 1,
    });
    let calls = 0;
    seam.child = async () => {
      calls++;
      return calls === 2
        ? result({
            state: "not-graded",
            notGradedReason: OUT_OF_CREDIT_REASON,
            outOfCredit: true,
          })
        : result();
    };
    await runPluginEval({ evalId: "pev_1" });
    expect(recorded).toHaveLength(2);
    expect(finished).toEqual([{ phase: "partial", reason: "out_of_credit" }]);
  });

  it("records a child that fails outright as a try not graded", async () => {
    const { recorded, finished } = suite({
      kind: "run",
      org: "acme",
      cells: cells(1),
      maxCostUsd: 10,
      concurrency: 1,
    });
    seam.child = () => Promise.reject(new Error("the child failed"));
    await runPluginEval({ evalId: "pev_1" });
    expect(recorded[0]?.result).toMatchObject({
      state: "not-graded",
      notGradedReason: TRY_FAILED_REASON,
    });
    expect(finished).toEqual([{ phase: "completed" }]);
  });

  it("records every child in flight when cancelled, starts no cell after, ends partial, cancelled, and rethrows", async () => {
    const { recorded, finished } = suite(
      { kind: "run", org: "acme", cells: cells(4), maxCostUsd: 10, concurrency: 2 },
      { sessionId: "ses_9", runId: "run_9", costUsd: 0.2 },
    );
    const started: string[] = [];
    seam.child = async (_type, options) => {
      const position = started.push(options.workflowId);
      await Promise.resolve();
      seam.cancelled = true;
      if (position === 1) {
        // A child that answers its cancellation with its own result.
        return result({
          state: "not-graded",
          notGradedReason: TRY_CANCELLED_REASON,
          costUsd: 0.3,
        });
      }
      throw new CancelledFailure("cancelled");
    };
    await expect(runPluginEval({ evalId: "pev_1" })).rejects.toBeInstanceOf(
      CancelledFailure,
    );
    expect(started).toHaveLength(2);
    // The two settle in either order; each is recorded once.
    expect(recorded).toHaveLength(2);
    expect(recorded.map((entry) => entry.result)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runId: "run_1",
        notGradedReason: TRY_CANCELLED_REASON,
        costUsd: 0.3,
      }),
      expect.objectContaining({
        sessionId: "ses_9",
        runId: "run_9",
        state: "not-graded",
        notGradedReason: TRY_CANCELLED_REASON,
        costUsd: 0.2,
      }),
    ]));
    expect(finished).toEqual([{ phase: "partial", reason: "cancelled" }]);
  });

  it("ends cancelled when every child in flight answered its cancel with a result", async () => {
    const { recorded, finished } = suite({
      kind: "run",
      org: "acme",
      cells: cells(2),
      maxCostUsd: 10,
      concurrency: 1,
    });
    seam.child = async () => {
      seam.cancelled = true;
      return result({ state: "not-graded", notGradedReason: TRY_CANCELLED_REASON });
    };
    await expect(runPluginEval({ evalId: "pev_1" })).rejects.toBeInstanceOf(
      CancelledFailure,
    );
    expect(recorded).toHaveLength(1);
    expect(finished).toEqual([{ phase: "partial", reason: "cancelled" }]);
  });

  it("prefers the cancellation over a record that fails while cancelling", async () => {
    const { finished } = suite({
      kind: "run",
      org: "acme",
      cells: cells(1),
      maxCostUsd: 10,
      concurrency: 1,
    });
    seam.activities[RECORD_TRY_ACTIVITY_NAME] = vi.fn(() =>
      Promise.reject(stepFailure(RECORD_TRY_ACTIVITY_NAME, "the store is down")),
    );
    seam.child = () => Promise.reject(new CancelledFailure("cancelled"));
    await expect(runPluginEval({ evalId: "pev_1" })).rejects.toBeInstanceOf(
      CancelledFailure,
    );
    expect(finished).toEqual([{ phase: "partial", reason: "cancelled" }]);
  });

  it("caps each try at what is left of the limit, never below the floor", async () => {
    suite({
      kind: "run",
      org: "acme",
      cells: cells(3),
      maxCostUsd: 0.205,
      concurrency: 1,
    });
    const budgets: number[] = [];
    seam.child = async (_type, options) => {
      budgets.push((options.args[0] as CaseInput).budgetUsd);
      return result({ costUsd: 0.1 });
    };
    await runPluginEval({ evalId: "pev_1" });
    expect(budgets).toHaveLength(3);
    expect(budgets[0]).toBeCloseTo(0.205);
    expect(budgets[1]).toBeCloseTo(0.105);
    expect(budgets[2]).toBe(TRY_MIN_BUDGET_USD);
  });

  it("caps each try at an equal share of what is left, within what the running caps leave", async () => {
    suite({
      kind: "run",
      org: "acme",
      cells: cells(4),
      maxCostUsd: 1,
      concurrency: 2,
    });
    const budgets: number[] = [];
    const finishes: Array<() => void> = [];
    seam.child = async (_type, options) => {
      budgets.push((options.args[0] as CaseInput).budgetUsd);
      await new Promise<void>((resolve) => finishes.push(resolve));
      return result({ costUsd: 0.3 });
    };
    const running = runPluginEval({ evalId: "pev_1" });
    const settle = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };
    await settle();
    // Two may run at once: each starts with half of the limit.
    expect(budgets).toEqual([0.5, 0.5]);
    finishes.shift()!();
    await settle();
    // Half of the 0.7 left is 0.35, but the second still holds 0.5: 0.2.
    expect(budgets[2]).toBeCloseTo(0.2);
    finishes.shift()!();
    await settle();
    // Half of the 0.4 left is 0.2, and the third holds 0.2: 0.2.
    expect(budgets[3]).toBeCloseTo(0.2);
    while (finishes.length > 0) {
      finishes.shift()!();
      await settle();
    }
    await running;
    expect(budgets).toHaveLength(4);
  });

  it("starts no try while the finished spend and the caps still held reach the limit", async () => {
    const { recorded, finished } = suite({
      kind: "run",
      org: "acme",
      cells: cells(8),
      maxCostUsd: 0.05,
      concurrency: 8,
    });
    const budgets: number[] = [];
    const finishes: Array<() => void> = [];
    seam.child = async (_type, options) => {
      budgets.push((options.args[0] as CaseInput).budgetUsd);
      await new Promise<void>((resolve) => finishes.push(resolve));
      return result({ costUsd: 0.01 });
    };
    const running = runPluginEval({ evalId: "pev_1" });
    const settle = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };
    await settle();
    // An eighth of $0.05 is below the floor, so each try holds the floor,
    // and the sixth would find nothing left once five hold it all.
    expect(budgets).toEqual(Array.from({ length: 5 }, () => TRY_MIN_BUDGET_USD));
    while (finishes.length > 0) {
      finishes.shift()!();
      await settle();
    }
    await running;
    expect(budgets).toHaveLength(5);
    expect(recorded).toHaveLength(5);
    expect(finished).toEqual([{ phase: "partial", reason: "cost_ceiling" }]);
  });

  it("starts a held-back try once a running one finishes under its cap", async () => {
    const { recorded, finished } = suite({
      kind: "run",
      org: "acme",
      cells: cells(8),
      maxCostUsd: 0.05,
      concurrency: 8,
    });
    const budgets: number[] = [];
    const finishes: Array<() => void> = [];
    seam.child = async (_type, options) => {
      budgets.push((options.args[0] as CaseInput).budgetUsd);
      await new Promise<void>((resolve) => finishes.push(resolve));
      return result({ costUsd: 0.001 });
    };
    const running = runPluginEval({ evalId: "pev_1" });
    const settle = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };
    await settle();
    expect(budgets).toHaveLength(5);
    finishes.shift()!();
    await settle();
    // The first spent $0.001 of its $0.01: $0.009 is left beyond the caps held.
    expect(budgets).toHaveLength(6);
    while (finishes.length > 0) {
      finishes.shift()!();
      await settle();
    }
    await running;
    expect(budgets).toHaveLength(8);
    expect(recorded).toHaveLength(8);
    expect(finished).toEqual([{ phase: "completed" }]);
  });

  it("keeps the cap of a try whose run could not be stopped held for the rest of the eval", async () => {
    const { recorded, finished } = suite({
      kind: "run",
      org: "acme",
      cells: cells(3),
      maxCostUsd: 1,
      concurrency: 2,
    });
    const budgets: number[] = [];
    const finishes: Array<(outcome: TryResult) => void> = [];
    seam.child = async (_type, options) => {
      budgets.push((options.args[0] as CaseInput).budgetUsd);
      return new Promise<TryResult>((resolve) => finishes.push(resolve));
    };
    const running = runPluginEval({ evalId: "pev_1" });
    const settle = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };
    await settle();
    expect(budgets).toEqual([0.5, 0.5]);
    // Its run may still be going: its $0.50 stays held, its $0.10 so far within it.
    finishes.shift()!(
      result({
        state: "not-graded",
        notGradedReason: TRY_NOT_STOPPED_REASON,
        costUsd: 0.1,
      }),
    );
    await settle();
    expect(budgets).toHaveLength(2);
    finishes.shift()!(result({ costUsd: 0.2 }));
    await settle();
    // $1 less the $0.20 spent and the $0.50 still held.
    expect(budgets[2]).toBeCloseTo(0.3);
    finishes.shift()!(result({ costUsd: 0.1 }));
    await settle();
    await running;
    expect(recorded).toHaveLength(3);
    expect(finished).toEqual([{ phase: "completed" }]);
  });

  it("ends at the cost ceiling once a try whose run could not be stopped holds all that is left", async () => {
    const { recorded, finished } = suite({
      kind: "run",
      org: "acme",
      cells: cells(2),
      maxCostUsd: 1,
      concurrency: 1,
    });
    seam.child = async () =>
      result({
        state: "not-graded",
        notGradedReason: TRY_NOT_STOPPED_REASON,
        costUsd: 0.1,
      });
    await runPluginEval({ evalId: "pev_1" });
    expect(recorded).toHaveLength(1);
    expect(finished).toEqual([{ phase: "partial", reason: "cost_ceiling" }]);
  });

  it("shares what is left among the tries not yet finished when fewer remain than the concurrency", async () => {
    suite({
      kind: "run",
      org: "acme",
      cells: cells(2),
      maxCostUsd: 1,
      concurrency: 8,
    });
    const budgets: number[] = [];
    const finishes: Array<() => void> = [];
    seam.child = async (_type, options) => {
      budgets.push((options.args[0] as CaseInput).budgetUsd);
      await new Promise<void>((resolve) => finishes.push(resolve));
      return result({ costUsd: 0.2 });
    };
    const running = runPluginEval({ evalId: "pev_1" });
    const settle = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };
    await settle();
    // Two tries at concurrency 8: each gets half of the limit, not an eighth.
    expect(budgets).toEqual([0.5, 0.5]);
    while (finishes.length > 0) {
      finishes.shift()!();
      await settle();
    }
    await running;
  });

  it("hands a try nothing when nothing is left, and the floor only while something is", () => {
    expect(tryBudgetUsd(0.05, 0.05, 0, 1)).toBe(0);
    expect(tryBudgetUsd(0.05, 0.06, 0, 1)).toBe(0);
    expect(tryBudgetUsd(0.05, 0, 0.05, 8)).toBe(0);
    // Floating point leaves 3.5e-18 here, which is nothing.
    expect(tryBudgetUsd(0.05, 0.02, 0.03, 8)).toBe(0);
    expect(tryBudgetUsd(0.05, 0, 0.049, 8)).toBe(TRY_MIN_BUDGET_USD);
    expect(tryBudgetUsd(1, 0.2, 0, 2)).toBeCloseTo(0.4);
  });

  it("counts what a failed child's run spent, read by its label and name, against the limit", async () => {
    const { recorded, finished } = suite(
      { kind: "run", org: "acme", cells: cells(5), maxCostUsd: 0.25, concurrency: 1 },
      { sessionId: "ses_9", runId: "run_9", costUsd: 0.2 },
    );
    seam.child = () => Promise.reject(new Error("the child failed"));
    await runPluginEval({ evalId: "pev_1" });
    expect(seam.activities[TRY_SPEND_ACTIVITY_NAME]).toHaveBeenCalledWith(
      "pev_1",
      { caseIndex: 0, targetIndex: 0, arm: "with", tryIndex: 0 },
    );
    expect(recorded.map((entry) => entry.result)).toEqual([
      expect.objectContaining({
        sessionId: "ses_9",
        runId: "run_9",
        costUsd: 0.2,
        notGradedReason: TRY_FAILED_REASON,
      }),
      expect.objectContaining({ costUsd: 0.2 }),
    ]);
    expect(finished).toEqual([{ phase: "partial", reason: "cost_ceiling" }]);
  });

  it("records a failed child with its spend when the eval's cancel lands during the spend read", async () => {
    const { recorded, finished } = suite({
      kind: "run",
      org: "acme",
      cells: cells(2),
      maxCostUsd: 10,
      concurrency: 1,
    });
    seam.child = () => Promise.reject(new Error("the child failed"));
    seam.activities[TRY_SPEND_ACTIVITY_NAME] = vi.fn(() => {
      seam.cancelled = true;
      // A cancellable scope would see the cancel land here.
      return seam.shielded > 0
        ? Promise.resolve({ sessionId: "ses_9", runId: "run_9", costUsd: 0.2 })
        : Promise.reject(new CancelledFailure("cancelled"));
    });
    await expect(runPluginEval({ evalId: "pev_1" })).rejects.toBeInstanceOf(
      CancelledFailure,
    );
    expect(recorded.map((entry) => entry.result)).toEqual([
      expect.objectContaining({
        runId: "run_9",
        costUsd: 0.2,
        notGradedReason: TRY_FAILED_REASON,
      }),
    ]);
    expect(finished).toEqual([{ phase: "partial", reason: "cancelled" }]);
  });

  it("records a failed child at no cost when its spend cannot be read, and rethrows a cancellation there", async () => {
    const { recorded } = suite({
      kind: "run",
      org: "acme",
      cells: cells(1),
      maxCostUsd: 10,
      concurrency: 1,
    });
    seam.child = () => Promise.reject(new Error("the child failed"));
    seam.activities[TRY_SPEND_ACTIVITY_NAME] = vi.fn(() =>
      Promise.reject(new Error("the store is down")),
    );
    await runPluginEval({ evalId: "pev_1" });
    expect(recorded[0]?.result).toMatchObject({ runId: "", costUsd: 0 });

    const { finished } = suite({
      kind: "run",
      org: "acme",
      cells: cells(1),
      maxCostUsd: 10,
      concurrency: 1,
    });
    seam.activities[TRY_SPEND_ACTIVITY_NAME] = vi.fn(() =>
      Promise.reject(new CancelledFailure("cancelled")),
    );
    await expect(runPluginEval({ evalId: "pev_1" })).rejects.toBeInstanceOf(
      CancelledFailure,
    );
    expect(finished).toEqual([{ phase: "partial", reason: "cancelled" }]);
  });

  it("ends the eval failed with the reason when a record fails past its retries, once the tries in flight settle", async () => {
    const { finished } = suite({
      kind: "run",
      org: "acme",
      cells: cells(4),
      maxCostUsd: 10,
      concurrency: 2,
    });
    let records = 0;
    seam.activities[RECORD_TRY_ACTIVITY_NAME] = vi.fn(() => {
      records++;
      return records === 1
        ? Promise.reject(stepFailure(RECORD_TRY_ACTIVITY_NAME, "the store is down"))
        : Promise.resolve();
    });
    let children = 0;
    seam.child = async () => {
      children++;
      return result();
    };
    await runPluginEval({ evalId: "pev_1" });
    expect(children).toBe(2);
    expect(records).toBe(2);
    expect(finished).toEqual([
      { phase: "failed", error: `${TRY_NOT_RECORDED_ERROR}: the store is down` },
    ]);
  });

  it("ends the eval failed when the load fails past its retries", async () => {
    const { finished } = suite({ kind: "stop" });
    seam.activities[LOAD_SUITE_ACTIVITY_NAME] = vi.fn(() =>
      Promise.reject(stepFailure(LOAD_SUITE_ACTIVITY_NAME, "")),
    );
    await runPluginEval({ evalId: "pev_1" });
    expect(finished).toEqual([{ phase: "failed", error: EVAL_NOT_PLANNED_ERROR }]);

    const again = suite({ kind: "stop" });
    seam.activities[LOAD_SUITE_ACTIVITY_NAME] = vi.fn(() =>
      Promise.reject(new Error("not an activity failure")),
    );
    await runPluginEval({ evalId: "pev_1" });
    expect(again.finished).toEqual([
      { phase: "failed", error: `${EVAL_NOT_PLANNED_ERROR}: not an activity failure` },
    ]);
  });

  it("writes a failed eval's end even when the eval's cancel lands during it", async () => {
    suite({ kind: "stop" });
    const ends: unknown[] = [];
    seam.activities[LOAD_SUITE_ACTIVITY_NAME] = vi.fn(() =>
      Promise.reject(stepFailure(LOAD_SUITE_ACTIVITY_NAME, "")),
    );
    seam.activities[FINISH_EVAL_ACTIVITY_NAME] = vi.fn((_id: string, end: unknown) => {
      seam.cancelled = true;
      if (seam.shielded === 0) {
        return Promise.reject(new CancelledFailure("cancelled"));
      }
      ends.push(end);
      return Promise.resolve();
    });
    await runPluginEval({ evalId: "pev_1" });
    expect(ends).toEqual([{ phase: "failed", error: EVAL_NOT_PLANNED_ERROR }]);
  });

  it("lets the case's grading and steps activities finish before a cancel goes on, so a cancel never races a write", () => {
    const retry = { initialInterval: "2 seconds", backoffCoefficient: 2, maximumAttempts: 5 };
    const waits = ActivityCancellationType.WAIT_CANCELLATION_COMPLETED;
    expect(seam.proxies).toContainEqual({ cancellationType: waits, startToCloseTimeout: "1 minute", retry });
    expect(seam.proxies).toContainEqual({ cancellationType: waits, startToCloseTimeout: "5 minutes", retry });
  });

  it("retries the finish without a bound of its own, within the workflow's execution timeout", () => {
    expect(seam.proxies).toContainEqual({
      startToCloseTimeout: "1 minute",
      retry: {
        initialInterval: "2 seconds",
        backoffCoefficient: 2,
        maximumInterval: "1 minute",
      },
    });
  });

  it("rethrows a cancellation of the load after ending the eval cancelled", async () => {
    const { finished } = suite({ kind: "stop" });
    seam.activities[LOAD_SUITE_ACTIVITY_NAME] = vi.fn(() =>
      Promise.reject(new CancelledFailure("cancelled")),
    );
    await expect(runPluginEval({ evalId: "pev_1" })).rejects.toBeInstanceOf(
      CancelledFailure,
    );
    expect(finished).toEqual([{ phase: "partial", reason: "cancelled" }]);
  });

  it("fails outright, non-retryable, when the finish itself fails, after trying to end the eval failed", async () => {
    suite({ kind: "run", org: "acme", cells: cells(1), maxCostUsd: 10, concurrency: 1 });
    seam.child = async () => result();
    const ends: unknown[] = [];
    seam.activities[FINISH_EVAL_ACTIVITY_NAME] = vi.fn((_id: string, end: unknown) => {
      ends.push(end);
      return Promise.reject(new Error("the store is down"));
    });
    const failure = await runPluginEval({ evalId: "pev_1" }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ApplicationFailure);
    expect(failure).toMatchObject({
      type: PLUGIN_EVAL_SUITE_FAILED_FAILURE_TYPE,
      nonRetryable: true,
      message: `${EVAL_WORKFLOW_FAILED_ERROR}: the store is down`,
    });
    expect(ends).toEqual([
      { phase: "completed" },
      { phase: "failed", error: `${EVAL_WORKFLOW_FAILED_ERROR}: the store is down` },
    ]);
  });

  it("ends the eval failed and fails outright, non-retryable, on an error of the workflow's own", async () => {
    const { finished } = suite({
      kind: "run",
      org: "acme",
      cells: null,
      maxCostUsd: 10,
      concurrency: 1,
    });
    const failure = await runPluginEval({ evalId: "pev_1" }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ApplicationFailure);
    expect(failure).toMatchObject({
      type: PLUGIN_EVAL_SUITE_FAILED_FAILURE_TYPE,
      nonRetryable: true,
    });
    expect(finished).toEqual([
      {
        phase: "failed",
        error: expect.stringMatching(new RegExp(`^${EVAL_WORKFLOW_FAILED_ERROR}: `)),
      },
    ]);
  });

  it("ends at once when the load plans nothing", async () => {
    const { finished } = suite({ kind: "stop" });
    await runPluginEval({ evalId: "pev_1" });
    expect(finished).toEqual([]);
  });
});

const INPUT: CaseInput = {
  evalId: "pev_1",
  org: "acme",
  caseIndex: 0,
  targetIndex: 0,
  arm: "with",
  tryIndex: 0,
  timeoutSeconds: 120,
  budgetUsd: 5,
};

/** A poll of a run that has ended, of one a runner has taken, and of one waiting for a runner. */
const ENDED: RunPoll = { phase: "ended", startedAtMs: 0 };
const RUNNING: RunPoll = { phase: "running", startedAtMs: 0 };
const PENDING: RunPoll = { phase: "pending", startedAtMs: 0 };

/** A stop that records the fake clock at each call. */
function timedStop(): { readonly fn: ReturnType<typeof vi.fn>; readonly at: number[] } {
  const at: number[] = [];
  return {
    at,
    fn: vi.fn(() => {
      at.push(Date.now());
      return Promise.resolve();
    }),
  };
}

/** What the spend activity finds for the try's run in these scripts. */
const SPENT: TrySpend = { sessionId: "ses_1", runId: "run_1", costUsd: 0.4 };

const GRADE: TryGrade = {
  outcomes: [{ votes: "criteria" }, { passed: true, reason: "found" }],
  error: "",
  costUsd: 0.2,
  durationSeconds: 5,
};

function caseScript(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  seam.activities = {
    [START_TRY_ACTIVITY_NAME]: vi.fn(() =>
      Promise.resolve({ kind: "started", sessionId: "ses_1", runId: "run_1" }),
    ),
    [POLL_RUN_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(ENDED)),
    [STOP_RUN_ACTIVITY_NAME]: vi.fn(() => Promise.resolve()),
    [GRADE_TRY_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(GRADE)),
    [START_VOTE_ACTIVITY_NAME]: vi.fn(
      (_input: CaseInput, _run: string, grader: number, vote: number) =>
        Promise.resolve({
          kind: "started",
          voteRunId: `vote_${grader}_${vote}`,
        }),
    ),
    [READ_VOTE_ACTIVITY_NAME]: vi.fn(() =>
      Promise.resolve({
        vote: { kind: "vote", passed: true, reason: "yes" },
        costUsd: 0.01,
      }),
    ),
    [DELETE_VOTE_ACTIVITY_NAME]: vi.fn(() => Promise.resolve()),
    [RECORD_SCORE_ACTIVITY_NAME]: vi.fn(
      (
        _input: CaseInput,
        started: { sessionId: string; runId: string },
        grade: TryGrade,
      ) => Promise.resolve(result({ ...started, costUsd: grade.costUsd })),
    ),
    [TRY_SPEND_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(SPENT)),
    ...overrides,
  };
  return seam.activities;
}

function busyFailure(): ActivityFailure {
  return new ActivityFailure(
    "start failed",
    START_TRY_ACTIVITY_NAME,
    "1",
    undefined,
    "worker",
    ApplicationFailure.create({
      message: "full",
      type: PLUGIN_EVAL_BUSY_FAILURE_TYPE,
    }),
  );
}

/** A start that failed with `cause`, as the activity proxy reports it. */
function activityFailure(cause: Error): ActivityFailure {
  return new ActivityFailure(
    "start failed",
    START_TRY_ACTIVITY_NAME,
    "1",
    undefined,
    "worker",
    cause,
  );
}

describe("the case workflow", () => {
  it("starts, waits, grades, takes three votes per AI-graded check, and records", async () => {
    const activities = caseScript();
    const outcome = await runCase(INPUT);
    expect(activities[START_VOTE_ACTIVITY_NAME]).toHaveBeenCalledTimes(3);
    expect(activities[READ_VOTE_ACTIVITY_NAME]).toHaveBeenCalledWith(
      "vote_0_2",
      "criteria",
    );
    const recordCall = activities[RECORD_SCORE_ACTIVITY_NAME]!.mock.calls[0]!;
    expect(recordCall[3]).toEqual([
      [
        { kind: "vote", passed: true, reason: "yes" },
        { kind: "vote", passed: true, reason: "yes" },
        { kind: "vote", passed: true, reason: "yes" },
      ],
      [],
    ]);
    expect(outcome.costUsd).toBeCloseTo(0.23);
    expect(activities[STOP_RUN_ACTIVITY_NAME]).not.toHaveBeenCalled();
    expect(activities[DELETE_VOTE_ACTIVITY_NAME]!.mock.calls).toEqual([
      ["vote_0_0"],
      ["vote_0_1"],
      ["vote_0_2"],
    ]);
  });

  it("counts a read vote whose session cannot be deleted, leaving the session", async () => {
    caseScript({
      [DELETE_VOTE_ACTIVITY_NAME]: vi.fn(() =>
        Promise.reject(stepFailure(DELETE_VOTE_ACTIVITY_NAME, "the store is down")),
      ),
    });
    expect(await runCase(INPUT)).toMatchObject({
      state: "graded",
      costUsd: expect.closeTo(0.23),
    });
  });

  it("leaves a vote whose delete failed to the spend read, which still holds it, never counting it twice", async () => {
    /** The first vote's delete fails past its retries; the third vote cannot be read. */
    const script = (spend: ReturnType<typeof vi.fn>) =>
      caseScript({
        [DELETE_VOTE_ACTIVITY_NAME]: vi
          .fn()
          .mockImplementationOnce(() =>
            Promise.reject(stepFailure(DELETE_VOTE_ACTIVITY_NAME, "the store is down")),
          )
          .mockImplementation(() => Promise.resolve()),
        [READ_VOTE_ACTIVITY_NAME]: vi
          .fn()
          .mockImplementationOnce(() =>
            Promise.resolve({ vote: { kind: "vote", passed: true, reason: "yes" }, costUsd: 0.01 }),
          )
          .mockImplementationOnce(() =>
            Promise.resolve({ vote: { kind: "vote", passed: true, reason: "yes" }, costUsd: 0.01 }),
          )
          .mockImplementation(() => Promise.reject(new Error("the store is down"))),
        [TRY_SPEND_ACTIVITY_NAME]: spend,
      });
    // The spend read (0.4) holds the try's run, the undeleted vote and the
    // unread one; the tally holds only the vote deleted.
    script(vi.fn(() => Promise.resolve(SPENT)));
    expect(await runCase(INPUT)).toMatchObject({
      notGradedReason: VOTE_NOT_READ_REASON,
      costUsd: expect.closeTo(0.41),
    });
    // A spend read that fails too: the grade's cost and both votes read.
    script(vi.fn(() => Promise.reject(new Error("down"))));
    expect((await runCase(INPUT)).costUsd).toBeCloseTo(0.22);
  });

  it("counts a vote whose delete failed once when the try is cancelled and its spend cannot be read", async () => {
    caseScript({
      [DELETE_VOTE_ACTIVITY_NAME]: vi
        .fn()
        .mockImplementationOnce(() =>
          Promise.reject(stepFailure(DELETE_VOTE_ACTIVITY_NAME, "the store is down")),
        )
        .mockImplementationOnce(() =>
          Promise.reject(new CancelledFailure("cancelled")),
        ),
      [TRY_SPEND_ACTIVITY_NAME]: vi.fn(() => Promise.reject(new Error("down"))),
    });
    expect(await runCase(INPUT)).toMatchObject({
      notGradedReason: TRY_CANCELLED_REASON,
      costUsd: expect.closeTo(0.01),
    });
  });

  it("answers a cancellation at a vote's delete as cancelled, counting that vote once, through the spend still stored", async () => {
    const activities = caseScript({
      [DELETE_VOTE_ACTIVITY_NAME]: vi
        .fn()
        .mockImplementationOnce(() => Promise.resolve())
        .mockImplementationOnce(() =>
          Promise.reject(new CancelledFailure("cancelled")),
        ),
    });
    // The spend read (0.4) holds the try's run and the undeleted vote; the
    // tally holds the one vote already deleted.
    expect(await runCase(INPUT)).toMatchObject({
      notGradedReason: TRY_CANCELLED_REASON,
      costUsd: expect.closeTo(0.41),
    });
    expect(activities[STOP_RUN_ACTIVITY_NAME]!.mock.calls).toEqual([
      ["vote_0_1", "the eval was cancelled"],
      ["run_1", "the eval was cancelled"],
    ]);
    expect(activities[RECORD_SCORE_ACTIVITY_NAME]).not.toHaveBeenCalled();
  });

  it("leaves the try not graded when a vote cannot be read, stopping that vote and counting every vote's spend", async () => {
    const reads = () => {
      let count = 0;
      return vi.fn(() => {
        count++;
        return count === 3
          ? Promise.reject(new Error("the store is down"))
          : Promise.resolve({
              vote: { kind: "vote", passed: true, reason: "yes" },
              costUsd: 0.01,
            });
      });
    };
    const activities = caseScript({ [READ_VOTE_ACTIVITY_NAME]: reads() });
    const outcome = await runCase(INPUT);
    expect(VOTE_NOT_READ_REASON).toBe("the AI-graded check could not be read");
    expect(outcome).toMatchObject({
      sessionId: "ses_1",
      runId: "run_1",
      state: "not-graded",
      notGradedReason: VOTE_NOT_READ_REASON,
      durationSeconds: 5,
    });
    // The try's run and the unread vote, still stored, plus the two votes read.
    expect(outcome.costUsd).toBeCloseTo(0.4 + 0.02);
    expect(activities[STOP_RUN_ACTIVITY_NAME]).toHaveBeenCalledWith(
      "vote_0_2",
      expect.any(String),
    );
    expect(activities[RECORD_SCORE_ACTIVITY_NAME]).not.toHaveBeenCalled();

    // A spend read that fails too falls back to the grade's cost and the votes read.
    caseScript({
      [READ_VOTE_ACTIVITY_NAME]: reads(),
      [TRY_SPEND_ACTIVITY_NAME]: vi.fn(() => Promise.reject(new Error("down"))),
    });
    expect((await runCase(INPUT)).costUsd).toBeCloseTo(0.2 + 0.02);
  });

  it("stops the run at the deadline and grades what it produced", async () => {
    const activities = caseScript({
      [POLL_RUN_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(RUNNING)),
    });
    const started = Date.now();
    await runCase(INPUT);
    expect(activities[STOP_RUN_ACTIVITY_NAME]).toHaveBeenCalledWith(
      "run_1",
      "timed out after 120s",
    );
    expect(activities[GRADE_TRY_ACTIVITY_NAME]).toHaveBeenCalledWith(
      INPUT,
      "run_1",
      true,
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(120_000);
  });

  it("leaves a try whose run no runner took within the capacity wait not graded, platform busy, its run stopped and never scored", async () => {
    const stop = timedStop();
    const activities = caseScript({
      [POLL_RUN_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(PENDING)),
      [STOP_RUN_ACTIVITY_NAME]: stop.fn,
    });
    const started = Date.now();
    expect(await runCase(INPUT)).toMatchObject({
      state: "not-graded",
      notGradedReason: PLATFORM_BUSY_REASON,
      sessionId: "ses_1",
      runId: "run_1",
      costUsd: 0.4,
    });
    expect(stop.fn).toHaveBeenCalledWith(
      "run_1",
      "no runner took the try in time",
    );
    expect(activities[GRADE_TRY_ACTIVITY_NAME]).not.toHaveBeenCalled();
    expect(activities[RECORD_SCORE_ACTIVITY_NAME]).not.toHaveBeenCalled();
    // Stopped at the capacity wait, not the case's 120 seconds.
    expect(stop.at[0]! - started).toBe(30 * 60_000);
  });

  it("leaves a never-started try whose run cannot be stopped not graded with that reason, and answers a cancel at that stop as cancelled", async () => {
    caseScript({
      [POLL_RUN_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(PENDING)),
      [STOP_RUN_ACTIVITY_NAME]: vi.fn(() =>
        Promise.reject(new Error("the runner is gone")),
      ),
    });
    expect((await runCase(INPUT)).notGradedReason).toBe(TRY_NOT_STOPPED_REASON);

    caseScript({
      [POLL_RUN_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(PENDING)),
      [STOP_RUN_ACTIVITY_NAME]: vi
        .fn()
        .mockImplementationOnce(() =>
          Promise.reject(new CancelledFailure("cancelled")),
        )
        .mockImplementation(() => Promise.resolve()),
    });
    expect((await runCase(INPUT)).notGradedReason).toBe(TRY_CANCELLED_REASON);
  });

  it("counts the case's timeout from when the run started, not from the try's start", async () => {
    const begun = Date.now();
    // Pending for ten minutes; then running, stamped a minute before that
    // poll saw it.
    const stop = timedStop();
    const activities = caseScript({
      [POLL_RUN_ACTIVITY_NAME]: vi.fn(() =>
        Promise.resolve(
          Date.now() - begun < 10 * 60_000
            ? PENDING
            : { phase: "running", startedAtMs: begun + 9 * 60_000 },
        ),
      ),
      [STOP_RUN_ACTIVITY_NAME]: stop.fn,
    });
    await runCase(INPUT);
    expect(stop.fn).toHaveBeenCalledWith("run_1", "timed out after 120s");
    expect(activities[GRADE_TRY_ACTIVITY_NAME]).toHaveBeenCalledWith(
      INPUT,
      "run_1",
      true,
    );
    // At the stamp plus the case's 120 seconds.
    expect(stop.at[0]! - begun).toBe(9 * 60_000 + 120_000);
  });

  it("reads a start stamp outside the wait as the try's start or the poll that saw it", async () => {
    // A stamp from before the try's own start (a skewed clock) counts from
    // that start; one from the future counts from the poll that saw it,
    // the first, three seconds in.
    for (const [stamp, expected] of [
      [1, 120_000],
      [Number.MAX_SAFE_INTEGER, 3_000 + 120_000],
    ] as const) {
      const begun = Date.now();
      const stop = timedStop();
      caseScript({
        [POLL_RUN_ACTIVITY_NAME]: vi.fn(() =>
          Promise.resolve({ phase: "running", startedAtMs: stamp }),
        ),
        [STOP_RUN_ACTIVITY_NAME]: stop.fn,
      });
      await runCase(INPUT);
      expect(stop.at[0]! - begun).toBe(expected);
    }
  });

  it("starts the timeout at the first poll that sees the run out of pending when it carries no stamp", async () => {
    const begun = Date.now();
    let seenAt = 0;
    const stop = timedStop();
    caseScript({
      [POLL_RUN_ACTIVITY_NAME]: vi.fn(() => {
        if (Date.now() - begun < 5 * 60_000) {
          return Promise.resolve(PENDING);
        }
        seenAt ||= Date.now();
        return Promise.resolve(RUNNING);
      }),
      [STOP_RUN_ACTIVITY_NAME]: stop.fn,
    });
    await runCase(INPUT);
    expect(seenAt - begun).toBeGreaterThanOrEqual(5 * 60_000);
    expect(stop.at[0]! - seenAt).toBe(120_000);
  });

  it("reads a poll that fails past its retries as telling nothing, and keeps waiting", async () => {
    const activities = caseScript({
      [POLL_RUN_ACTIVITY_NAME]: vi
        .fn()
        .mockImplementationOnce(() => Promise.reject(new Error("the store is down")))
        .mockImplementationOnce(() => Promise.reject(new Error("the store is down")))
        .mockImplementation(() => Promise.resolve(ENDED)),
    });
    expect(await runCase(INPUT)).toMatchObject({ state: "graded" });
    expect(activities[STOP_RUN_ACTIVITY_NAME]).not.toHaveBeenCalled();
    expect(activities[GRADE_TRY_ACTIVITY_NAME]).toHaveBeenCalledWith(INPUT, "run_1", false);
  });

  it("polls a vote at most about twenty times within its ten minutes", async () => {
    const voteRun = "vote_0_0";
    const poll = vi.fn((runId: string) =>
      Promise.resolve(runId === voteRun ? RUNNING : ENDED),
    );
    caseScript({ [POLL_RUN_ACTIVITY_NAME]: poll });
    await runCase(INPUT);
    const votePolls = poll.mock.calls.filter(([runId]) => runId === voteRun);
    expect(votePolls.length).toBeGreaterThanOrEqual(15);
    expect(votePolls.length).toBeLessThanOrEqual(21);
  });

  it("answers each start refusal without a score", async () => {
    caseScript({
      [START_TRY_ACTIVITY_NAME]: vi.fn(() =>
        Promise.resolve({
          kind: "refused",
          failure: "out-of-credit",
          reason: OUT_OF_CREDIT_REASON,
        }),
      ),
    });
    expect(await runCase(INPUT)).toMatchObject({
      state: "not-graded",
      notGradedReason: OUT_OF_CREDIT_REASON,
      outOfCredit: true,
    });
    caseScript({
      [START_TRY_ACTIVITY_NAME]: vi.fn(() =>
        Promise.resolve({ kind: "refused", failure: "cannot-act", reason: "" }),
      ),
    });
    expect((await runCase(INPUT)).notGradedReason).toBe(CANNOT_ACT_REASON);
    caseScript({
      [START_TRY_ACTIVITY_NAME]: vi.fn(() =>
        Promise.resolve({
          kind: "refused",
          failure: "cannot-act",
          reason: "the eval's creator can no longer run it",
        }),
      ),
    });
    expect((await runCase(INPUT)).notGradedReason).toBe(
      "the eval's creator can no longer run it",
    );
    caseScript({
      [START_TRY_ACTIVITY_NAME]: vi.fn(() =>
        Promise.resolve({
          kind: "refused",
          failure: "not-started",
          reason: "model 'x' needs a key",
        }),
      ),
    });
    expect((await runCase(INPUT)).notGradedReason).toBe(
      "model 'x' needs a key",
    );
    caseScript({
      [START_TRY_ACTIVITY_NAME]: vi.fn(() => Promise.reject(busyFailure())),
    });
    expect((await runCase(INPUT)).notGradedReason).toBe(PLATFORM_BUSY_REASON);
    caseScript({
      [START_TRY_ACTIVITY_NAME]: vi.fn(() =>
        Promise.reject(new Error("broken")),
      ),
    });
    expect((await runCase(INPUT)).notGradedReason).toBe(TRY_NOT_STARTED_REASON);
  });

  it("fails outright, non-retryable, on an unexpected error inside the try, for the suite to record it as a failed child with its spend", async () => {
    // A grade with no outcomes is not a shape the grade activity answers; the
    // workflow's own read of it throws a TypeError, which is failed as an
    // ApplicationFailure so Temporal fails the workflow, not just its task,
    // once the try's run is stopped.
    const activities = caseScript({
      [GRADE_TRY_ACTIVITY_NAME]: vi.fn(() => Promise.resolve({})),
    });
    const failure = await runCase(INPUT).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ApplicationFailure);
    expect(failure).toMatchObject({
      type: PLUGIN_EVAL_CASE_FAILED_FAILURE_TYPE,
      nonRetryable: true,
    });
    expect((failure as ApplicationFailure).message).toBe(
      "Cannot read properties of undefined (reading 'entries')",
    );
    expect(activities[STOP_RUN_ACTIVITY_NAME]!.mock.calls).toEqual([
      ["run_1", "the try's workflow failed"],
    ]);
  });

  it("stops the vote's run and the try's before failing on an error of its own while a vote runs", async () => {
    let polls = 0;
    const activities = caseScript({
      [POLL_RUN_ACTIVITY_NAME]: vi.fn(() => {
        polls++;
        // The try's run has ended; the vote's poll answers a shape the
        // workflow cannot read, a defect's answer.
        return Promise.resolve(
          polls === 1
            ? ENDED
            : {
                get phase(): never {
                  throw new Error("an unreadable poll");
                },
              },
        );
      }),
    });
    await expect(runCase(INPUT)).rejects.toMatchObject({
      type: PLUGIN_EVAL_CASE_FAILED_FAILURE_TYPE,
      message: "an unreadable poll",
    });
    expect(activities[STOP_RUN_ACTIVITY_NAME]!.mock.calls).toEqual([
      ["vote_0_0", "the try's workflow failed"],
      ["run_1", "the try's workflow failed"],
    ]);
  });

  it("fails with a Temporal failure of its own as it is", async () => {
    const own = ApplicationFailure.nonRetryable("the grade is unusable", "Unusable");
    caseScript({
      [GRADE_TRY_ACTIVITY_NAME]: vi.fn(() =>
        Promise.resolve({
          get outcomes(): never {
            throw own;
          },
        }),
      ),
    });
    await expect(runCase(INPUT)).rejects.toBe(own);
  });

  it("fails a thrown non-error value as an ApplicationFailure naming it", async () => {
    caseScript({
      [GRADE_TRY_ACTIVITY_NAME]: vi.fn(() =>
        Promise.resolve({
          get outcomes(): never {
            // A value that is not an Error, as a defect could throw.
            throw "no outcomes";
          },
        }),
      ),
    });
    await expect(runCase(INPUT)).rejects.toMatchObject({
      message: "no outcomes",
      type: PLUGIN_EVAL_CASE_FAILED_FAILURE_TYPE,
    });
  });

  it("reads busy through a deeper cause, and any other start failure as not started", async () => {
    caseScript({
      [START_TRY_ACTIVITY_NAME]: vi.fn(() =>
        Promise.reject(
          activityFailure(
            new Error("the lane gave up", {
              cause: ApplicationFailure.create({
                message: "full",
                type: PLUGIN_EVAL_BUSY_FAILURE_TYPE,
              }),
            }),
          ),
        ),
      ),
    });
    expect((await runCase(INPUT)).notGradedReason).toBe(PLATFORM_BUSY_REASON);
    caseScript({
      [START_TRY_ACTIVITY_NAME]: vi.fn(() =>
        Promise.reject(
          activityFailure(
            ApplicationFailure.create({ message: "bad", type: "Invalid" }),
          ),
        ),
      ),
    });
    expect((await runCase(INPUT)).notGradedReason).toBe(TRY_NOT_STARTED_REASON);
  });

  it("answers a cancellation at the start, the grade, a vote's start or the record as a try not graded, cancelled, its run stopped", async () => {
    const cancelled = () => Promise.reject(new CancelledFailure("cancelled"));
    for (const [step, votesRead] of [
      [START_TRY_ACTIVITY_NAME, 0],
      [GRADE_TRY_ACTIVITY_NAME, 0],
      [START_VOTE_ACTIVITY_NAME, 0],
      [RECORD_SCORE_ACTIVITY_NAME, 3],
    ] as const) {
      const activities = caseScript({ [step]: vi.fn(cancelled) });
      expect(await runCase(INPUT), step).toMatchObject({
        state: "not-graded",
        notGradedReason: TRY_CANCELLED_REASON,
        sessionId: "ses_1",
        runId: "run_1",
        costUsd: expect.closeTo(0.4 + votesRead * 0.01),
      });
      expect(
        activities[STOP_RUN_ACTIVITY_NAME],
        `${step}: the try's run is stopped`,
      ).toHaveBeenCalledWith("run_1", "the eval was cancelled");
      if (step !== RECORD_SCORE_ACTIVITY_NAME) {
        expect(
          activities[RECORD_SCORE_ACTIVITY_NAME],
          `${step}: nothing is recorded after the cancellation`,
        ).not.toHaveBeenCalled();
      }
    }
  });

  it("answers a cancellation at a vote's read as cancelled, stopping that vote's run and the try's", async () => {
    const activities = caseScript({
      [READ_VOTE_ACTIVITY_NAME]: vi.fn(() =>
        Promise.reject(new CancelledFailure("cancelled")),
      ),
    });
    expect(await runCase(INPUT)).toMatchObject({
      state: "not-graded",
      notGradedReason: TRY_CANCELLED_REASON,
      costUsd: expect.closeTo(0.4),
    });
    expect(activities[STOP_RUN_ACTIVITY_NAME]).toHaveBeenCalledWith(
      "vote_0_0",
      "the eval was cancelled",
    );
    expect(activities[STOP_RUN_ACTIVITY_NAME]).toHaveBeenCalledWith(
      "run_1",
      "the eval was cancelled",
    );
  });

  it("finds the run by the spend activity when a start's answer is lost to the cancellation, and stops nothing when there is none", async () => {
    const found = caseScript({
      [START_TRY_ACTIVITY_NAME]: vi.fn(() =>
        Promise.reject(new CancelledFailure("cancelled")),
      ),
      [TRY_SPEND_ACTIVITY_NAME]: vi
        .fn()
        .mockImplementationOnce(() =>
          Promise.resolve({ sessionId: "ses_7", runId: "run_7", costUsd: 0 }),
        )
        .mockImplementation(() =>
          Promise.resolve({ sessionId: "ses_7", runId: "run_7", costUsd: 0.25 }),
        ),
    });
    expect(await runCase(INPUT)).toMatchObject({
      notGradedReason: TRY_CANCELLED_REASON,
      sessionId: "ses_7",
      runId: "run_7",
      costUsd: 0.25,
    });
    expect(found[STOP_RUN_ACTIVITY_NAME]).toHaveBeenCalledWith(
      "run_7",
      "the eval was cancelled",
    );

    const none = caseScript({
      [START_TRY_ACTIVITY_NAME]: vi.fn(() =>
        Promise.reject(new CancelledFailure("cancelled")),
      ),
      [TRY_SPEND_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(NO_SPEND)),
    });
    expect(await runCase(INPUT)).toMatchObject({
      notGradedReason: TRY_CANCELLED_REASON,
      sessionId: "",
      runId: "",
      costUsd: 0,
    });
    expect(none[STOP_RUN_ACTIVITY_NAME]).not.toHaveBeenCalled();
  });

  it("stops the run when cancelled while waiting, and answers it cancelled, still if the stop or the spend read fails", async () => {
    const activities = caseScript({
      [POLL_RUN_ACTIVITY_NAME]: vi
        .fn()
        .mockImplementationOnce(() =>
          Promise.reject(new CancelledFailure("cancelled")),
        )
        .mockImplementation(() => Promise.resolve(ENDED)),
    });
    expect(await runCase(INPUT)).toMatchObject({
      notGradedReason: TRY_CANCELLED_REASON,
      runId: "run_1",
      costUsd: 0.4,
    });
    expect(activities[STOP_RUN_ACTIVITY_NAME]).toHaveBeenCalledWith(
      "run_1",
      "the eval was cancelled",
    );
    expect(activities[GRADE_TRY_ACTIVITY_NAME]).not.toHaveBeenCalled();

    caseScript({
      [POLL_RUN_ACTIVITY_NAME]: vi
        .fn()
        .mockImplementationOnce(() =>
          Promise.reject(new CancelledFailure("cancelled")),
        )
        .mockImplementation(() => Promise.resolve(ENDED)),
      [STOP_RUN_ACTIVITY_NAME]: vi.fn(() =>
        Promise.reject(new Error("the runner is gone")),
      ),
      [TRY_SPEND_ACTIVITY_NAME]: vi.fn(() =>
        Promise.reject(new Error("the store is down")),
      ),
    });
    expect(await runCase(INPUT)).toMatchObject({
      notGradedReason: TRY_CANCELLED_REASON,
      sessionId: "ses_1",
      runId: "run_1",
      costUsd: 0,
    });
  });

  it("leaves the try not graded when grading or recording fails for good, counting what its run spent", async () => {
    const graded = caseScript({
      [GRADE_TRY_ACTIVITY_NAME]: vi.fn(() =>
        Promise.reject(new Error("store down")),
      ),
    });
    expect(await runCase(INPUT)).toMatchObject({
      state: "not-graded",
      notGradedReason: GRADING_FAILED_REASON,
      runId: "run_1",
      costUsd: 0.4,
    });
    expect(graded[TRY_SPEND_ACTIVITY_NAME]).toHaveBeenCalledWith("pev_1", {
      caseIndex: 0,
      targetIndex: 0,
      arm: "with",
      tryIndex: 0,
    });
    caseScript({
      [RECORD_SCORE_ACTIVITY_NAME]: vi.fn(() =>
        Promise.reject(new Error("store down")),
      ),
    });
    expect(await runCase(INPUT)).toMatchObject({
      state: "not-graded",
      costUsd: expect.closeTo(0.23),
    });
  });

  it("keeps the try's ids at no cost when its failed grade's run cannot be found or read", async () => {
    for (const spend of [
      vi.fn(() => Promise.resolve({ sessionId: "", runId: "", costUsd: 0 })),
      vi.fn(() => Promise.reject(new Error("the store is down"))),
    ]) {
      caseScript({
        [GRADE_TRY_ACTIVITY_NAME]: vi.fn(() =>
          Promise.reject(new Error("store down")),
        ),
        [TRY_SPEND_ACTIVITY_NAME]: spend,
      });
      expect(await runCase(INPUT)).toMatchObject({
        notGradedReason: GRADING_FAILED_REASON,
        sessionId: "ses_1",
        runId: "run_1",
        costUsd: 0,
      });
    }
  });

  it("leaves a try whose run could not be stopped not graded, with what the run spent", async () => {
    const activities = caseScript({
      [POLL_RUN_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(RUNNING)),
      [STOP_RUN_ACTIVITY_NAME]: vi.fn(() =>
        Promise.reject(new Error("the runner is gone")),
      ),
    });
    expect(await runCase(INPUT)).toMatchObject({
      state: "not-graded",
      notGradedReason: TRY_NOT_STOPPED_REASON,
      runId: "run_1",
      costUsd: 0.4,
    });
    expect(activities[GRADE_TRY_ACTIVITY_NAME]).not.toHaveBeenCalled();
  });

  it("answers a cancellation at the deadline's stop as cancelled, stopping the run again", async () => {
    const activities = caseScript({
      [POLL_RUN_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(RUNNING)),
      [STOP_RUN_ACTIVITY_NAME]: vi
        .fn()
        .mockImplementationOnce(() =>
          Promise.reject(new CancelledFailure("cancelled")),
        )
        .mockImplementation(() => Promise.resolve()),
    });
    expect((await runCase(INPUT)).notGradedReason).toBe(TRY_CANCELLED_REASON);
    expect(activities[STOP_RUN_ACTIVITY_NAME]).toHaveBeenLastCalledWith(
      "run_1",
      "the eval was cancelled",
    );
  });

  it("carries the run an earlier start attempt left when the start fails, and no spend when it cannot be read", async () => {
    caseScript({
      [START_TRY_ACTIVITY_NAME]: vi.fn(() => Promise.reject(new Error("broken"))),
    });
    expect(await runCase(INPUT)).toMatchObject({
      notGradedReason: TRY_NOT_STARTED_REASON,
      sessionId: "ses_1",
      runId: "run_1",
      costUsd: 0.4,
    });
    caseScript({
      [START_TRY_ACTIVITY_NAME]: vi.fn(() => Promise.reject(new Error("broken"))),
      [TRY_SPEND_ACTIVITY_NAME]: vi.fn(() =>
        Promise.reject(new Error("the store is down")),
      ),
    });
    expect(await runCase(INPUT)).toMatchObject({ runId: "", costUsd: 0 });
    caseScript({
      [START_TRY_ACTIVITY_NAME]: vi.fn(() => Promise.reject(new Error("broken"))),
      [TRY_SPEND_ACTIVITY_NAME]: vi.fn(() =>
        Promise.reject(new CancelledFailure("cancelled")),
      ),
    });
    expect(await runCase(INPUT)).toMatchObject({
      notGradedReason: TRY_CANCELLED_REASON,
      runId: "",
      costUsd: 0,
    });
  });

  it("counts a vote that cannot start, or a refused one, as failed", async () => {
    const activities = caseScript({
      [START_VOTE_ACTIVITY_NAME]: vi
        .fn()
        .mockImplementationOnce(() => Promise.reject(busyFailure()))
        .mockImplementationOnce(() =>
          Promise.resolve({ kind: "failed", reason: OUT_OF_CREDIT_REASON }),
        )
        .mockImplementationOnce(() => Promise.reject(new Error("broken"))),
    });
    await runCase(INPUT);
    expect(activities[READ_VOTE_ACTIVITY_NAME]).not.toHaveBeenCalled();
    expect(activities[RECORD_SCORE_ACTIVITY_NAME]!.mock.calls[0]![3]).toEqual([
      [
        { kind: "failed", reason: PLATFORM_BUSY_REASON },
        { kind: "failed", reason: OUT_OF_CREDIT_REASON },
        { kind: "failed", reason: "the judge could not start" },
      ],
      [],
    ]);
  });

  it("stops a vote's run and the try's when cancelled while the vote runs, counting the votes already read", async () => {
    const activities = caseScript({
      [POLL_RUN_ACTIVITY_NAME]: vi
        .fn()
        .mockImplementationOnce(() => Promise.resolve(ENDED))
        .mockImplementationOnce(() => Promise.resolve(ENDED))
        .mockImplementationOnce(() =>
          Promise.reject(new CancelledFailure("cancelled")),
        )
        .mockImplementation(() => Promise.resolve(ENDED)),
    });
    expect(await runCase(INPUT)).toMatchObject({
      notGradedReason: TRY_CANCELLED_REASON,
      costUsd: expect.closeTo(0.41),
    });
    expect(activities[STOP_RUN_ACTIVITY_NAME]!.mock.calls).toEqual([
      ["vote_0_1", "the eval was cancelled"],
      ["run_1", "the eval was cancelled"],
    ]);
  });
});

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
 * The suite: every cell run and recorded (without its grader results), at
 * most `concurrency` children in flight; the cost ceiling checked before
 * each cell, each child capped at what is left of the limit less the caps
 * of the children still running (never below the floor); a credit refusal
 * stopping new cells; a child that fails recorded as not graded with what
 * its run spent, which the ceiling counts; a cancellation recording every
 * child in flight (its own cancelled answer, or one read through the spend
 * activity), starting no cell after, ending the eval partial "cancelled"
 * and rethrown;
 * a load or a record failing past its retries ending the eval failed with
 * the reason; an eval planning nothing ending at once.
 *
 * The case: start, wait, grade, three votes per AI-graded check, record;
 * the deadline stopping the run and grading what it produced; each start
 * refusal answered (credit, cannot act, the run's own, busy past the
 * retries, busy found deeper in the failure's causes, any other failure
 * as grading failed); a cancellation anywhere (the start, the wait, the
 * grade, a vote, the record, the deadline's stop, the spend read)
 * stopping the try's run and any vote's run, the run found by the spend
 * activity when the start's answer is unknown, and answered as a try not
 * graded, "cancelled", with its ids and what it spent; a grade, a stop or
 * a start that fails leaving the try not graded with what its run spent;
 * a vote that cannot start counted as failed.
 */
import {
  ActivityFailure,
  ApplicationFailure,
  CancelledFailure,
} from "@temporalio/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CANNOT_ACT_REASON,
  FINISH_EVAL_ACTIVITY_NAME,
  GRADE_TRY_ACTIVITY_NAME,
  GRADING_FAILED_REASON,
  LOAD_SUITE_ACTIVITY_NAME,
  OUT_OF_CREDIT_REASON,
  PLATFORM_BUSY_REASON,
  PLUGIN_EVAL_BUSY_FAILURE_TYPE,
  POLL_RUN_ACTIVITY_NAME,
  READ_VOTE_ACTIVITY_NAME,
  RECORD_SCORE_ACTIVITY_NAME,
  RECORD_TRY_ACTIVITY_NAME,
  RUN_CASE_WORKFLOW_TYPE,
  START_TRY_ACTIVITY_NAME,
  START_VOTE_ACTIVITY_NAME,
  STOP_RUN_ACTIVITY_NAME,
  EVAL_NOT_PLANNED_ERROR,
  TRY_FAILED_REASON,
  TRY_MIN_BUDGET_USD,
  TRY_NOT_RECORDED_ERROR,
  TRY_NOT_STOPPED_REASON,
  TRY_CANCELLED_REASON,
  TRY_SPEND_ACTIVITY_NAME,
} from "../names.js";
import type {
  CaseInput,
  RecordedTry,
  SuiteCell,
  TryGrade,
  TryResult,
  TrySpend,
} from "../names.js";

const seam = vi.hoisted(() => ({
  activities: {} as Record<string, ReturnType<typeof vi.fn>>,
  /** Whether the workflow's scope has been cancelled. */
  cancelled: false,
  child: (() => Promise.reject(new Error("no child expected"))) as (
    type: string,
    options: { workflowId: string; args: unknown[] },
  ) => Promise<unknown>,
}));

vi.mock("@temporalio/workflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@temporalio/workflow")>();
  return {
    ...actual,
    proxyActivities: () =>
      new Proxy({}, { get: (_target, name: string) => seam.activities[name] }),
    executeChild: (
      type: string,
      options: { workflowId: string; args: unknown[] },
    ) => seam.child(type, options),
    CancellationScope: {
      nonCancellable: <T>(fn: () => Promise<T>) => fn(),
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

const { runPluginEval } = await import("../workflows/run-plugin-eval.js");
const { runCase } = await import("../workflows/run-case.js");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  seam.activities = {};
  seam.cancelled = false;
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
    graderResults: [],
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
  const recorded: Array<{ cell: SuiteCell; result: RecordedTry }> = [];
  const finished: unknown[] = [];
  seam.activities = {
    [LOAD_SUITE_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(plan)),
    [RECORD_TRY_ACTIVITY_NAME]: vi.fn(
      (_id: string, cell: SuiteCell, outcome: RecordedTry) => {
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

  it("records each try without its grader results", async () => {
    const { recorded } = suite({
      kind: "run",
      org: "acme",
      cells: cells(1),
      maxCostUsd: 10,
      concurrency: 1,
    });
    seam.child = async () =>
      result({
        graderResults: [
          { name: "a", scored: true, verdict: { passed: true, reason: "ok" } },
        ],
      });
    await runPluginEval({ evalId: "pev_1" });
    expect(recorded[0]?.result).not.toHaveProperty("graderResults");
    expect(recorded[0]?.result).toMatchObject({ runId: "run_1", score: 1 });
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

  it("caps each try at the limit less the recorded spend and the caps still running", async () => {
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
    // The first try holds the whole limit, so the second starts at the floor.
    expect(budgets).toEqual([1, TRY_MIN_BUDGET_USD]);
    finishes.shift()!();
    await settle();
    // 1 - 0.3 spent - the floor the second still holds.
    expect(budgets[2]).toBeCloseTo(0.69);
    finishes.shift()!();
    await settle();
    // 1 - 0.6 spent - the 0.69 the third still holds: the floor.
    expect(budgets[3]).toBe(TRY_MIN_BUDGET_USD);
    while (finishes.length > 0) {
      finishes.shift()!();
      await settle();
    }
    await running;
    expect(budgets).toHaveLength(4);
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

  it("rethrows a failure of the finish itself", async () => {
    suite({ kind: "run", org: "acme", cells: cells(1), maxCostUsd: 10, concurrency: 1 });
    seam.child = async () => result();
    seam.activities[FINISH_EVAL_ACTIVITY_NAME] = vi.fn(() =>
      Promise.reject(new Error("the store is down")),
    );
    await expect(runPluginEval({ evalId: "pev_1" })).rejects.toThrow(
      "the store is down",
    );
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
    [POLL_RUN_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(true)),
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
  });

  it("stops the run at the deadline and grades what it produced", async () => {
    const activities = caseScript({
      [POLL_RUN_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(false)),
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
    expect((await runCase(INPUT)).notGradedReason).toBe(GRADING_FAILED_REASON);
  });

  it("reads busy through a deeper cause, and any other activity failure as grading failed", async () => {
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
    expect((await runCase(INPUT)).notGradedReason).toBe(GRADING_FAILED_REASON);
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
        .mockImplementation(() => Promise.resolve(true)),
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
        .mockImplementation(() => Promise.resolve(true)),
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
      [POLL_RUN_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(false)),
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
      [POLL_RUN_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(false)),
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
      notGradedReason: GRADING_FAILED_REASON,
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
        .mockImplementationOnce(() => Promise.resolve(true))
        .mockImplementationOnce(() => Promise.resolve(true))
        .mockImplementationOnce(() =>
          Promise.reject(new CancelledFailure("cancelled")),
        )
        .mockImplementation(() => Promise.resolve(true)),
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

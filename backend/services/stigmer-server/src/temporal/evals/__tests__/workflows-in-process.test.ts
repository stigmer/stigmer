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
 * in flight; the cost ceiling checked before each cell; a credit refusal
 * stopping new cells; a child that fails recorded as not graded; a
 * cancellation ending the eval partial "cancelled" and rethrown; an eval
 * planning nothing ending at once.
 *
 * The case: start, wait, grade, three votes per AI-graded check, record;
 * the deadline stopping the run and grading what it produced; each start
 * refusal answered (credit, cannot act, the run's own, busy past the
 * retries, busy found deeper in the failure's causes, any other failure
 * as grading failed); a cancellation stopping the run; a cancellation at
 * the start, the grade, a vote's start or the record rethrown, never
 * answered as a try not graded; a grade that fails leaving the try not
 * graded; a vote that cannot start counted as failed.
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
  TRY_FAILED_REASON,
} from "../names.js";
import type { CaseInput, SuiteCell, TryGrade, TryResult } from "../names.js";

const seam = vi.hoisted(() => ({
  activities: {} as Record<string, ReturnType<typeof vi.fn>>,
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
    CancellationScope: { nonCancellable: <T>(fn: () => Promise<T>) => fn() },
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

function suite(plan: unknown) {
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
  };
  return { recorded, finished };
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

  it("ends partial, cancelled, when cancelled, and rethrows", async () => {
    const { recorded, finished } = suite({
      kind: "run",
      org: "acme",
      cells: cells(3),
      maxCostUsd: 10,
      concurrency: 2,
    });
    let calls = 0;
    seam.child = async () => {
      calls++;
      if (calls === 2) {
        throw new CancelledFailure("cancelled");
      }
      return result();
    };
    await expect(runPluginEval({ evalId: "pev_1" })).rejects.toBeInstanceOf(
      CancelledFailure,
    );
    expect(recorded).toHaveLength(1);
    expect(finished).toEqual([{ phase: "partial", reason: "cancelled" }]);
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
};

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

  it("rethrows a cancellation at the start, the grade, a vote's start and the record", async () => {
    const cancelled = () => Promise.reject(new CancelledFailure("cancelled"));
    for (const step of [
      START_TRY_ACTIVITY_NAME,
      GRADE_TRY_ACTIVITY_NAME,
      START_VOTE_ACTIVITY_NAME,
      RECORD_SCORE_ACTIVITY_NAME,
    ]) {
      const activities = caseScript({ [step]: vi.fn(cancelled) });
      await expect(runCase(INPUT), step).rejects.toBeInstanceOf(
        CancelledFailure,
      );
      expect(
        activities[STOP_RUN_ACTIVITY_NAME],
        `${step}: no run is left going to stop`,
      ).not.toHaveBeenCalled();
      if (step !== RECORD_SCORE_ACTIVITY_NAME) {
        expect(
          activities[RECORD_SCORE_ACTIVITY_NAME],
          `${step}: nothing is recorded after the cancellation`,
        ).not.toHaveBeenCalled();
      }
    }
  });

  it("stops the run when cancelled while waiting, and rethrows", async () => {
    const activities = caseScript({
      [POLL_RUN_ACTIVITY_NAME]: vi.fn(() =>
        Promise.reject(new CancelledFailure("cancelled")),
      ),
    });
    await expect(runCase(INPUT)).rejects.toBeInstanceOf(CancelledFailure);
    expect(activities[STOP_RUN_ACTIVITY_NAME]).toHaveBeenCalledWith(
      "run_1",
      "the eval was cancelled",
    );
  });

  it("leaves the try not graded when grading or recording fails for good", async () => {
    caseScript({
      [GRADE_TRY_ACTIVITY_NAME]: vi.fn(() =>
        Promise.reject(new Error("store down")),
      ),
    });
    expect(await runCase(INPUT)).toMatchObject({
      state: "not-graded",
      notGradedReason: GRADING_FAILED_REASON,
      runId: "run_1",
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

  it("stops a vote's run when cancelled while it runs", async () => {
    const activities = caseScript({
      [POLL_RUN_ACTIVITY_NAME]: vi
        .fn()
        .mockImplementationOnce(() => Promise.resolve(true))
        .mockImplementationOnce(() =>
          Promise.reject(new CancelledFailure("cancelled")),
        ),
    });
    await expect(runCase(INPUT)).rejects.toBeInstanceOf(CancelledFailure);
    expect(activities[STOP_RUN_ACTIVITY_NAME]).toHaveBeenCalledWith(
      "vote_0_0",
      "the eval was cancelled",
    );
  });
});

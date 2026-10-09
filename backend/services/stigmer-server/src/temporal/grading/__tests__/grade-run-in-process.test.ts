/**
 * Pins the grading workflow's body in-process, so coverage measures the
 * body it runs: grade-run-workflow.temporal.test.ts drives the same
 * scenarios through a TestWorkflowEnvironment, but there the body runs in
 * the worker's bundle, which V8 coverage never maps back to grade-run.ts
 * (the schedule tick's precedent, tick-in-process.test.ts).
 *
 * The workflow SDK's activity proxy is replaced at the module seam and
 * answers from a script. What is pinned is the orchestration the module
 * owns: the grade activity's outcome is the workflow's; a grading failure
 * records the run as not graded with the byte-pinned reason; a
 * cancellation is rethrown, never recorded as not graded. Behind the judge's
 * patch: the planner, the start, the poll on a capped backoff against the
 * judge's ten minutes (the workflow's sleep moves a fake clock here), and
 * one record for every judge that started or failed to, with the failure
 * the workflow saw; an execution from before the patch ends after run
 * health.
 */
import {
  ActivityFailure,
  ApplicationFailure,
  CancelledFailure,
  TimeoutFailure,
  TimeoutType,
} from "@temporalio/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GRADE_ALREADY_GRADED,
  GRADE_RECORDED,
  GRADE_RUN_HEALTH_ACTIVITY_NAME,
  GRADING_FAILED_REASON,
  JUDGE_BUSY_FAILURE_TYPE,
  PLAN_JUDGE_ACTIVITY_NAME,
  POLL_JUDGE_ACTIVITY_NAME,
  RECORD_JUDGE_ACTIVITY_NAME,
  RECORD_NOT_GRADED_ACTIVITY_NAME,
  START_JUDGE_ACTIVITY_NAME,
  type JudgeTicket,
} from "../names.js";

const seam = vi.hoisted(() => ({
  activities: {} as Record<string, ReturnType<typeof vi.fn>>,
  patched: true,
}));

vi.mock("@temporalio/workflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@temporalio/workflow")>();
  return {
    ...actual,
    proxyActivities: () =>
      new Proxy({}, { get: (_target, name: string) => seam.activities[name] }),
    patched: () => seam.patched,
    // The workflow's clock in a test: each sleep moves the fake system time.
    sleep: (ms: number) => {
      vi.setSystemTime(Date.now() + ms);
      return Promise.resolve();
    },
  };
});

const TICKET: JudgeTicket = { evaluatorId: "evl_1", modelName: "", capUsd: 0.25 };

const { gradeRun } = await import("../workflows/grade-run.js");

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  seam.patched = true;
  seam.activities = {
    [PLAN_JUDGE_ACTIVITY_NAME]: vi.fn(() => Promise.resolve({ kind: "skip" })),
    [START_JUDGE_ACTIVITY_NAME]: vi.fn(() =>
      Promise.resolve({ kind: "started", judgeRunId: "run_judge" }),
    ),
    [POLL_JUDGE_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(true)),
    [RECORD_JUDGE_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(GRADE_RECORDED)),
    [GRADE_RUN_HEALTH_ACTIVITY_NAME]: vi.fn(() =>
      Promise.resolve(GRADE_ALREADY_GRADED),
    ),
    [RECORD_NOT_GRADED_ACTIVITY_NAME]: vi.fn(() =>
      Promise.resolve(GRADE_RECORDED),
    ),
  };
});

describe("gradeRun", () => {
  it("answers the grade activity's outcome", async () => {
    expect(await gradeRun("run_1")).toBe(GRADE_ALREADY_GRADED);
    expect(
      seam.activities[GRADE_RUN_HEALTH_ACTIVITY_NAME],
    ).toHaveBeenCalledWith("run_1");
    expect(
      seam.activities[RECORD_NOT_GRADED_ACTIVITY_NAME],
    ).not.toHaveBeenCalled();
  });

  it("records the run as not graded when grading fails", async () => {
    seam.activities[GRADE_RUN_HEALTH_ACTIVITY_NAME] = vi.fn(() =>
      Promise.reject(new Error("grading broke")),
    );
    expect(await gradeRun("run_1")).toBe(GRADE_RECORDED);
    expect(
      seam.activities[RECORD_NOT_GRADED_ACTIVITY_NAME],
    ).toHaveBeenCalledWith("run_1", GRADING_FAILED_REASON);
  });

  it("rethrows a cancellation without recording the run as not graded", async () => {
    seam.activities[GRADE_RUN_HEALTH_ACTIVITY_NAME] = vi.fn(() =>
      Promise.reject(new CancelledFailure("cancelled")),
    );
    await expect(gradeRun("run_1")).rejects.toBeInstanceOf(CancelledFailure);
    expect(
      seam.activities[RECORD_NOT_GRADED_ACTIVITY_NAME],
    ).not.toHaveBeenCalled();
  });

  it("ends after run health for an execution started before the judge", async () => {
    seam.patched = false;
    await gradeRun("run_1");
    expect(seam.activities[PLAN_JUDGE_ACTIVITY_NAME]).not.toHaveBeenCalled();
  });

  it("grades with the judge: start, poll until it ends, record with no failure", async () => {
    seam.activities[PLAN_JUDGE_ACTIVITY_NAME] = vi.fn(() =>
      Promise.resolve({ kind: "grade", ticket: TICKET }),
    );
    let polls = 0;
    seam.activities[POLL_JUDGE_ACTIVITY_NAME] = vi.fn(() => Promise.resolve(++polls > 2));
    expect(await gradeRun("run_1"), "run health's outcome stays the result").toBe(GRADE_ALREADY_GRADED);
    expect(seam.activities[START_JUDGE_ACTIVITY_NAME]).toHaveBeenCalledWith("run_1", TICKET);
    expect(polls).toBe(3);
    expect(seam.activities[RECORD_JUDGE_ACTIVITY_NAME]).toHaveBeenCalledWith("run_1", TICKET, "run_judge", "");
  });

  it("stops waiting past the judge's ten minutes and records it not finished", async () => {
    seam.activities[PLAN_JUDGE_ACTIVITY_NAME] = vi.fn(() =>
      Promise.resolve({ kind: "grade", ticket: TICKET }),
    );
    seam.activities[POLL_JUDGE_ACTIVITY_NAME] = vi.fn(() => Promise.resolve(false));
    await gradeRun("run_1");
    expect(seam.activities[RECORD_JUDGE_ACTIVITY_NAME]).toHaveBeenCalledWith(
      "run_1",
      TICKET,
      "run_judge",
      "not-finished",
    );
  });

  it("keeps polling past a failed poll", async () => {
    seam.activities[PLAN_JUDGE_ACTIVITY_NAME] = vi.fn(() =>
      Promise.resolve({ kind: "grade", ticket: TICKET }),
    );
    seam.activities[POLL_JUDGE_ACTIVITY_NAME] = vi
      .fn()
      .mockRejectedValueOnce(new Error("store blip"))
      .mockResolvedValue(true);
    await gradeRun("run_1");
    expect(seam.activities[RECORD_JUDGE_ACTIVITY_NAME]).toHaveBeenCalledWith("run_1", TICKET, "run_judge", "");
  });

  it("records a refused start with its failure, a busy platform as busy and any other failed start as not started", async () => {
    seam.activities[PLAN_JUDGE_ACTIVITY_NAME] = vi.fn(() =>
      Promise.resolve({ kind: "grade", ticket: TICKET }),
    );
    seam.activities[START_JUDGE_ACTIVITY_NAME] = vi
      .fn()
      .mockResolvedValueOnce({ kind: "refused", failure: "cannot-act" })
      .mockRejectedValueOnce(
        new ActivityFailure(
          "start failed",
          START_JUDGE_ACTIVITY_NAME,
          "1",
          undefined,
          "worker",
          ApplicationFailure.create({ message: "at capacity", type: JUDGE_BUSY_FAILURE_TYPE }),
        ),
      )
      .mockRejectedValueOnce(new Error("the start broke"))
      // The ten minutes ran out mid-retry: a timeout whose cause is the
      // last attempt's capacity refusal is still busy.
      .mockRejectedValueOnce(
        new ActivityFailure(
          "start timed out",
          START_JUDGE_ACTIVITY_NAME,
          "1",
          undefined,
          "worker",
          // The SDK sets a timeout's cause from the history's failure.
          Object.assign(
            new TimeoutFailure("schedule to close", undefined, TimeoutType.SCHEDULE_TO_CLOSE),
            { cause: ApplicationFailure.create({ message: "at capacity", type: JUDGE_BUSY_FAILURE_TYPE }) },
          ),
        ),
      )
      .mockRejectedValueOnce(
        new ActivityFailure(
          "start failed",
          START_JUDGE_ACTIVITY_NAME,
          "1",
          undefined,
          "worker",
          ApplicationFailure.create({ message: "store down", type: "Error" }),
        ),
      );
    for (const runId of ["run_a", "run_b", "run_c", "run_d", "run_e"]) {
      await gradeRun(runId);
    }
    expect(seam.activities[RECORD_JUDGE_ACTIVITY_NAME].mock.calls.map((call) => [call[0], call[3]])).toEqual([
      ["run_a", "cannot-act"],
      ["run_b", "busy"],
      ["run_c", "not-started"],
      ["run_d", "busy"],
      ["run_e", "not-started"],
    ]);
  });

  it("records nothing when the planner fails for good or already recorded the grade", async () => {
    seam.activities[PLAN_JUDGE_ACTIVITY_NAME] = vi
      .fn()
      .mockRejectedValueOnce(new Error("planner broke"))
      .mockResolvedValueOnce({ kind: "recorded" });
    await gradeRun("run_1");
    await gradeRun("run_1");
    expect(seam.activities[START_JUDGE_ACTIVITY_NAME]).not.toHaveBeenCalled();
    expect(seam.activities[RECORD_JUDGE_ACTIVITY_NAME]).not.toHaveBeenCalled();
  });

  it("rethrows a cancellation of the judge without recording it", async () => {
    seam.activities[PLAN_JUDGE_ACTIVITY_NAME] = vi.fn(() =>
      Promise.reject(new CancelledFailure("cancelled")),
    );
    await expect(gradeRun("run_1")).rejects.toBeInstanceOf(CancelledFailure);
    seam.activities[PLAN_JUDGE_ACTIVITY_NAME] = vi.fn(() =>
      Promise.resolve({ kind: "grade", ticket: TICKET }),
    );
    seam.activities[START_JUDGE_ACTIVITY_NAME] = vi.fn(() =>
      Promise.reject(new CancelledFailure("cancelled")),
    );
    await expect(gradeRun("run_1")).rejects.toBeInstanceOf(CancelledFailure);
    seam.activities[START_JUDGE_ACTIVITY_NAME] = vi.fn(() =>
      Promise.resolve({ kind: "started", judgeRunId: "run_judge" }),
    );
    seam.activities[POLL_JUDGE_ACTIVITY_NAME] = vi.fn(() =>
      Promise.reject(new CancelledFailure("cancelled")),
    );
    await expect(gradeRun("run_1")).rejects.toBeInstanceOf(CancelledFailure);
    expect(seam.activities[RECORD_JUDGE_ACTIVITY_NAME]).not.toHaveBeenCalled();
  });
});

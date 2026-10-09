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
 * cancellation is rethrown, never recorded as not graded.
 */
import { CancelledFailure } from "@temporalio/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GRADE_ALREADY_GRADED,
  GRADE_RECORDED,
  GRADE_RUN_HEALTH_ACTIVITY_NAME,
  GRADING_FAILED_REASON,
  RECORD_NOT_GRADED_ACTIVITY_NAME,
} from "../names.js";

const seam = vi.hoisted(() => ({
  activities: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("@temporalio/workflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@temporalio/workflow")>();
  return {
    ...actual,
    proxyActivities: () =>
      new Proxy({}, { get: (_target, name: string) => seam.activities[name] }),
  };
});

const { gradeRun } = await import("../workflows/grade-run.js");

beforeEach(() => {
  seam.activities = {
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
});

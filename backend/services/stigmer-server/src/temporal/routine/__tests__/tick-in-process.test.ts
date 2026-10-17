/**
 * Pins the tick workflow's orchestration in-process, so coverage measures
 * the body it runs: tick-workflow.temporal.test.ts drives the same
 * scenarios through a TestWorkflowEnvironment, but there the body runs in
 * the worker's bundle, which V8 coverage never maps back to tick.ts.
 *
 * The workflow SDK's context primitives are replaced at the module seam:
 * the activity proxies answer from a script, `sleep` records its delay and
 * returns at once, `workflowInfo` names a cron fire by the workflow-id
 * suffix, and `log.info` records the completion line. What is pinned is
 * the orchestration the module owns: the fire's nominal time reaches the
 * record and start activities; a declined record-tick and a SKIPPED run
 * start end the fire with nothing started or recorded; a refused start
 * records START_FAILED with its reason; the run is polled until it leaves
 * RUNNING with the tracking backoff between polls; and each terminal phase
 * reaches its verdict: a failed run records "run X ended failed", a
 * completed run resets the streak, a gone run records nothing, and an
 * exhausted tracking budget records RUN_TIMED_OUT.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FAILURE_RUN_FAILED,
  FAILURE_RUN_TIMED_OUT,
  FAILURE_START_FAILED,
  PHASE_COMPLETED,
  PHASE_FAILED,
  PHASE_GONE,
  PHASE_RUNNING,
  POLL_EXECUTION_PHASE_ACTIVITY_NAME,
  RECORD_FAILED_RUN_ACTIVITY_NAME,
  RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME,
  RECORD_TICK_ACTIVITY_NAME,
  RUN_REFUSED,
  RUN_SKIPPED,
  RUN_STARTED,
  START_SCHEDULED_RUN_ACTIVITY_NAME,
  TICK_FIRED,
  TICK_SKIPPED_DISABLED,
  artifactId,
  type RunStart,
} from "../names.js";

const ROUTINE_ID = "sch_tick";
const NOMINAL = "2026-10-01T09:00:00Z";

const seam = vi.hoisted(() => ({
  activities: {} as Record<string, ReturnType<typeof vi.fn>>,
  sleep: vi.fn((_ms: number) => Promise.resolve()),
  info: vi.fn((_message: string, _fields?: Record<string, unknown>) => {}),
  workflowId: "",
}));

vi.mock("@temporalio/workflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@temporalio/workflow")>();
  return {
    ...actual,
    proxyActivities: () =>
      new Proxy({}, { get: (_target, name: string) => seam.activities[name] }),
    sleep: seam.sleep,
    workflowInfo: () => ({
      workflowId: seam.workflowId,
      typedSearchAttributes: { get: () => undefined },
    }),
    log: { info: seam.info, warn: () => {}, error: () => {}, debug: () => {} },
  };
});

const { tick } = await import("../workflows/tick.js");

/** A run start the script answers, defaulting to a started, tracked run. */
function runStart(overrides?: Partial<RunStart>): RunStart {
  return {
    outcome: RUN_STARTED,
    executionId: "aex_tracked",
    trackingTimeoutMinutes: 60,
    failureReason: "",
    ...overrides,
  };
}

/** The fields of the one "Schedule tick complete" line the fire logged. */
function completionFields(): Record<string, unknown> | undefined {
  const lines = seam.info.mock.calls.filter(
    ([message]) => message === "Schedule tick complete",
  );
  expect(lines).toHaveLength(1);
  return lines[0]?.[1];
}

beforeEach(() => {
  seam.sleep.mockClear();
  seam.info.mockClear();
  seam.workflowId = `${artifactId(ROUTINE_ID)}-${NOMINAL}`;
  seam.activities = {
    [RECORD_TICK_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(TICK_FIRED)),
    [START_SCHEDULED_RUN_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(runStart())),
    [POLL_EXECUTION_PHASE_ACTIVITY_NAME]: vi
      .fn()
      .mockResolvedValueOnce(PHASE_RUNNING)
      .mockResolvedValueOnce(PHASE_FAILED),
    [RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME]: vi.fn(() => Promise.resolve()),
    [RECORD_FAILED_RUN_ACTIVITY_NAME]: vi.fn(() =>
      Promise.resolve({ consecutiveFailures: 1, paused: false }),
    ),
  };
});

describe("tick — tracking a started run in-process", () => {
  it("polls the run past RUNNING with the backoff and records its failure as the fire's verdict", async () => {
    await tick(ROUTINE_ID);

    const activities = seam.activities;
    expect(activities[RECORD_TICK_ACTIVITY_NAME]).toHaveBeenCalledWith(
      ROUTINE_ID,
      NOMINAL,
    );
    expect(activities[START_SCHEDULED_RUN_ACTIVITY_NAME]).toHaveBeenCalledWith(
      ROUTINE_ID,
      NOMINAL,
    );
    expect(
      activities[POLL_EXECUTION_PHASE_ACTIVITY_NAME],
    ).toHaveBeenCalledTimes(2);
    expect(activities[POLL_EXECUTION_PHASE_ACTIVITY_NAME]).toHaveBeenCalledWith(
      "aex_tracked",
    );
    expect(seam.sleep.mock.calls).toEqual([[5_000]]);
    expect(activities[RECORD_FAILED_RUN_ACTIVITY_NAME]).toHaveBeenCalledWith(
      ROUTINE_ID,
      "run aex_tracked ended failed",
      FAILURE_RUN_FAILED,
    );
    expect(
      activities[RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME],
    ).not.toHaveBeenCalled();
  });

  it("a completed run resets the streak and logs the completed verdict with no failure count", async () => {
    seam.activities[POLL_EXECUTION_PHASE_ACTIVITY_NAME] = vi
      .fn()
      .mockResolvedValueOnce(PHASE_COMPLETED);

    await tick(ROUTINE_ID);

    expect(
      seam.activities[RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME],
    ).toHaveBeenCalledWith(ROUTINE_ID);
    expect(
      seam.activities[RECORD_FAILED_RUN_ACTIVITY_NAME],
    ).not.toHaveBeenCalled();
    expect(seam.sleep).not.toHaveBeenCalled();
    expect(completionFields()).toEqual({
      routine_id: ROUTINE_ID,
      nominal_fire_time: NOMINAL,
      run_outcome: RUN_STARTED,
      execution_id: "aex_tracked",
      verdict: "completed",
    });
  });

  it("a run deleted mid-track records no verdict, so deleting a run never bricks its routine", async () => {
    seam.activities[POLL_EXECUTION_PHASE_ACTIVITY_NAME] = vi
      .fn()
      .mockResolvedValueOnce(PHASE_GONE);

    await tick(ROUTINE_ID);

    expect(
      seam.activities[RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME],
    ).not.toHaveBeenCalled();
    expect(
      seam.activities[RECORD_FAILED_RUN_ACTIVITY_NAME],
    ).not.toHaveBeenCalled();
    expect(completionFields()).toMatchObject({
      routine_id: ROUTINE_ID,
      execution_id: "aex_tracked",
      verdict: "gone",
    });
  });

  it("a run still RUNNING when its tracking budget runs out records RUN_TIMED_OUT, never sleeping past the deadline", async () => {
    // A zero-minute budget: the first RUNNING poll is already past it.
    seam.activities[START_SCHEDULED_RUN_ACTIVITY_NAME] = vi.fn(() =>
      Promise.resolve(runStart({ trackingTimeoutMinutes: 0 })),
    );
    seam.activities[POLL_EXECUTION_PHASE_ACTIVITY_NAME] = vi
      .fn()
      .mockResolvedValue(PHASE_RUNNING);
    seam.activities[RECORD_FAILED_RUN_ACTIVITY_NAME] = vi.fn(() =>
      Promise.resolve({ consecutiveFailures: 2, paused: true }),
    );

    await tick(ROUTINE_ID);

    expect(
      seam.activities[POLL_EXECUTION_PHASE_ACTIVITY_NAME],
    ).toHaveBeenCalledTimes(1);
    expect(seam.sleep).not.toHaveBeenCalled();
    expect(seam.activities[RECORD_FAILED_RUN_ACTIVITY_NAME]).toHaveBeenCalledWith(
      ROUTINE_ID,
      "run aex_tracked did not finish within 0 minutes",
      FAILURE_RUN_TIMED_OUT,
    );
    expect(completionFields()).toEqual({
      routine_id: ROUTINE_ID,
      nominal_fire_time: NOMINAL,
      run_outcome: RUN_STARTED,
      execution_id: "aex_tracked",
      verdict: "timed_out",
      consecutive_failures: 2,
      paused: true,
    });
  });
});

describe("tick — fires that start no tracked run", () => {
  it("a record-tick that declines the fire ends the tick before any run starts", async () => {
    seam.activities[RECORD_TICK_ACTIVITY_NAME] = vi.fn(() =>
      Promise.resolve(TICK_SKIPPED_DISABLED),
    );

    await tick(ROUTINE_ID);

    expect(
      seam.activities[START_SCHEDULED_RUN_ACTIVITY_NAME],
    ).not.toHaveBeenCalled();
    expect(completionFields()).toEqual({
      routine_id: ROUTINE_ID,
      nominal_fire_time: NOMINAL,
      outcome: TICK_SKIPPED_DISABLED,
    });
  });

  it("a SKIPPED run start ends the tick with nothing polled and no verdict", async () => {
    seam.activities[START_SCHEDULED_RUN_ACTIVITY_NAME] = vi.fn(() =>
      Promise.resolve(runStart({ outcome: RUN_SKIPPED, executionId: "" })),
    );

    await tick(ROUTINE_ID);

    expect(
      seam.activities[POLL_EXECUTION_PHASE_ACTIVITY_NAME],
    ).not.toHaveBeenCalled();
    expect(
      seam.activities[RECORD_FAILED_RUN_ACTIVITY_NAME],
    ).not.toHaveBeenCalled();
    expect(
      seam.activities[RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME],
    ).not.toHaveBeenCalled();
    expect(completionFields()).toEqual({
      routine_id: ROUTINE_ID,
      nominal_fire_time: NOMINAL,
      run_outcome: RUN_SKIPPED,
    });
  });

  it("a REFUSED run start records START_FAILED with the refusal's reason and polls nothing", async () => {
    seam.activities[START_SCHEDULED_RUN_ACTIVITY_NAME] = vi.fn(() =>
      Promise.resolve(
        runStart({
          outcome: RUN_REFUSED,
          executionId: "",
          failureReason: "run refused: gate said no",
        }),
      ),
    );

    await tick(ROUTINE_ID);

    expect(seam.activities[RECORD_FAILED_RUN_ACTIVITY_NAME]).toHaveBeenCalledWith(
      ROUTINE_ID,
      "run refused: gate said no",
      FAILURE_START_FAILED,
    );
    expect(
      seam.activities[POLL_EXECUTION_PHASE_ACTIVITY_NAME],
    ).not.toHaveBeenCalled();
    expect(completionFields()).toEqual({
      routine_id: ROUTINE_ID,
      nominal_fire_time: NOMINAL,
      run_outcome: RUN_REFUSED,
      verdict: "start_failed",
      consecutive_failures: 1,
      paused: false,
    });
  });
});

/**
 * Pins the tick workflow's tracking loop in-process, so coverage measures
 * the body it runs: tick-workflow.temporal.test.ts drives the same
 * scenarios through a TestWorkflowEnvironment, but there the body runs in
 * the worker's bundle, which V8 coverage never maps back to tick.ts.
 *
 * The workflow SDK's context primitives are replaced at the module seam:
 * the activity proxies answer from a script, `sleep` records its delay and
 * returns at once, and `workflowInfo` names a cron fire by the workflow-id
 * suffix. What is pinned is the orchestration the module owns: the fire's
 * nominal time reaches the record and start activities, the run is polled
 * until it leaves RUNNING with the tracking backoff between polls, and a
 * failed run records the "run X ended failed" verdict with its kind.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FAILURE_RUN_FAILED,
  PHASE_FAILED,
  PHASE_RUNNING,
  POLL_EXECUTION_PHASE_ACTIVITY_NAME,
  RECORD_FAILED_RUN_ACTIVITY_NAME,
  RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME,
  RECORD_TICK_ACTIVITY_NAME,
  RUN_STARTED,
  START_SCHEDULED_RUN_ACTIVITY_NAME,
  TICK_FIRED,
  artifactId,
} from "../names.js";

const SCHEDULE_ID = "sch_tick";
const NOMINAL = "2026-10-01T09:00:00Z";

const seam = vi.hoisted(() => ({
  activities: {} as Record<string, ReturnType<typeof vi.fn>>,
  sleep: vi.fn((_ms: number) => Promise.resolve()),
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
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
});

const { tick } = await import("../workflows/tick.js");

beforeEach(() => {
  seam.sleep.mockClear();
  seam.workflowId = `${artifactId(SCHEDULE_ID)}-${NOMINAL}`;
  seam.activities = {
    [RECORD_TICK_ACTIVITY_NAME]: vi.fn(() => Promise.resolve(TICK_FIRED)),
    [START_SCHEDULED_RUN_ACTIVITY_NAME]: vi.fn(() =>
      Promise.resolve({
        outcome: RUN_STARTED,
        executionId: "aex_tracked",
        trackingTimeoutMinutes: 60,
        failureReason: "",
      }),
    ),
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
    await tick(SCHEDULE_ID);

    const activities = seam.activities;
    expect(activities[RECORD_TICK_ACTIVITY_NAME]).toHaveBeenCalledWith(
      SCHEDULE_ID,
      NOMINAL,
    );
    expect(activities[START_SCHEDULED_RUN_ACTIVITY_NAME]).toHaveBeenCalledWith(
      SCHEDULE_ID,
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
      SCHEDULE_ID,
      "run aex_tracked ended failed",
      FAILURE_RUN_FAILED,
    );
    expect(
      activities[RECORD_SUCCESSFUL_RUN_ACTIVITY_NAME],
    ).not.toHaveBeenCalled();
  });
});

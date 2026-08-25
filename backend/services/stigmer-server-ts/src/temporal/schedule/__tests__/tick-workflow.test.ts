/**
 * Tick-workflow orchestration tests — port the scenario matrix of
 * pkg/domain/schedule/temporal/tick_workflow_test.go through a
 * TestWorkflowEnvironment with scripted activities.
 *
 * What these pin (the clock's orchestration contract):
 *   - skip outcomes end the tick without a run start;
 *   - start failures (TARGET_MISSING/REFUSED) record ONE failure with the
 *     START_FAILED kind and the deterministic reason;
 *   - a tracked run polls to COMPLETED → the success reset (never the
 *     failure recorder);
 *   - FAILED/CANCELLED/TERMINATED record the "run X ended <phase>" verdict;
 *   - GONE yields NO verdict (a deleted run must not brick its schedule);
 *   - budget exhaustion records RUN_TIMED_OUT with the byte-pinned reason
 *     and does NOT cancel the run;
 *   - a poll failure past retries fails the tick with NO verdict;
 *   - the 3-tier nominal-time derivation (workflow-id suffix, then
 *     workflow time truncated to whole seconds).
 *
 * Follows the invoke-workflow precedent: TestWorkflowEnvironment
 * .createLocal (needs the `temporal` CLI on PATH); every test skips
 * VISIBLY when the local test server cannot start — never a vacuous green
 * (the #18 panel lesson).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  FAILURE_RUN_FAILED,
  FAILURE_RUN_TIMED_OUT,
  FAILURE_START_FAILED,
  PHASE_COMPLETED,
  PHASE_FAILED,
  PHASE_GONE,
  PHASE_RUNNING,
  RUN_ALREADY_STARTED,
  RUN_REFUSED,
  RUN_SKIPPED,
  RUN_STARTED,
  RUN_TARGET_MISSING,
  TICK_FIRED,
  TICK_SKIPPED_DISABLED,
  TICK_WORKFLOW_TYPE,
  type FailureKind,
  type RunPhase,
  type RunStart,
  type ScheduleTickActivities,
  type TickOutcome,
} from "../names.js";
import { MAX_TRACKING_CYCLES, trackingBackoffMs } from "../workflows/tick.js";

const TASK_QUEUE = "tick-workflow-test";
const WORKFLOWS_PATH = new URL("../workflows/index.ts", import.meta.url).pathname;

type TestWorkflowEnvironment = import("@temporalio/testing").TestWorkflowEnvironment;
type Worker = import("@temporalio/worker").Worker;

let env: TestWorkflowEnvironment | null = null;
let worker: Worker | null = null;
let workerRunPromise: Promise<void> | null = null;
let envReady = false;

// ─── Scriptable activity doubles ────────────────────────────────────────

interface FailureCall {
  scheduleId: string;
  reason: string;
  kind: FailureKind;
}

interface TickScript {
  tickOutcome: TickOutcome;
  /** Thrown from record-tick when set (nonRetryable — fails the tick fast). */
  tickError?: string;
  recordTickArgs: Array<{ scheduleId: string; nominal: string }>;
  runStart: RunStart;
  /** Consumed per poll, in order; the last one sticks. */
  pollResults: RunPhase[];
  /** Thrown from poll when set. */
  pollError?: string;
  pollCount: number;
  successCalls: string[];
  failureCalls: FailureCall[];
}

let script: TickScript;

function resetScript(): void {
  script = {
    tickOutcome: TICK_FIRED,
    recordTickArgs: [],
    runStart: {
      outcome: RUN_STARTED,
      executionId: "aex_tick",
      trackingTimeoutMinutes: 60,
      failureReason: "",
    },
    pollResults: [PHASE_COMPLETED],
    pollCount: 0,
    successCalls: [],
    failureCalls: [],
  };
}
resetScript();

async function nonRetryable(message: string): Promise<never> {
  const { ApplicationFailure } = await import("@temporalio/common");
  throw ApplicationFailure.nonRetryable(message);
}

// Typed as the REAL activity surface: a signature change in
// ScheduleTickActivities flags these doubles at compile time instead of
// silently decoupling the tests from the contract they pin.
function scriptedActivities(): ScheduleTickActivities {
  return {
    "stigmer/schedule/record-tick": async (scheduleId, nominal) => {
      script.recordTickArgs.push({ scheduleId, nominal });
      if (script.tickError !== undefined) {
        await nonRetryable(script.tickError);
      }
      return script.tickOutcome;
    },
    "stigmer/schedule/start-run": async () => script.runStart,
    "stigmer/schedule/poll-phase": async () => {
      if (script.pollError !== undefined) {
        await nonRetryable(script.pollError);
      }
      script.pollCount++;
      return script.pollResults.length > 1
        ? script.pollResults.shift()!
        : script.pollResults[0]!;
    },
    "stigmer/schedule/record-success": async (scheduleId) => {
      script.successCalls.push(scheduleId);
    },
    "stigmer/schedule/record-failure": async (scheduleId, reason, kind) => {
      script.failureCalls.push({ scheduleId, reason, kind });
      return { consecutiveFailures: script.failureCalls.length, paused: false };
    },
  };
}

let workflowSeq = 0;

async function runTick(options?: { workflowId?: string }): Promise<void> {
  if (!env) throw new Error("TestWorkflowEnvironment not initialized");
  workflowSeq++;
  const handle = await env.client.workflow.start(TICK_WORKFLOW_TYPE, {
    taskQueue: TASK_QUEUE,
    workflowId: options?.workflowId ?? `tick-test-${workflowSeq}-${Date.now()}`,
    args: ["sch_tick"],
  });
  await handle.result();
}

describe("schedule/tick workflow (TestWorkflowEnvironment)", () => {
  beforeAll(async () => {
    try {
      const { TestWorkflowEnvironment: TWE } = await import("@temporalio/testing");
      const { Worker: W } = await import("@temporalio/worker");
      env = await TWE.createLocal();
      worker = await W.create({
        connection: env.nativeConnection,
        taskQueue: TASK_QUEUE,
        workflowsPath: WORKFLOWS_PATH,
        activities: scriptedActivities(),
      });
      workerRunPromise = worker.run();
      envReady = true;
    } catch (error) {
      console.warn(
        `Temporal test server unavailable (tests will be skipped): ${error instanceof Error ? error.message : String(error)}`,
      );
      envReady = false;
    }
  }, 120_000);

  afterAll(async () => {
    if (worker) {
      worker.shutdown();
      await workerRunPromise?.catch(() => {});
    }
    if (env) await env.teardown();
  }, 30_000);

  afterEach(() => {
    resetScript();
  });

  it("a skipped tick ends without a run start or verdict", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.tickOutcome = TICK_SKIPPED_DISABLED;

    await runTick();
    expect(script.recordTickArgs).toHaveLength(1);
    expect(script.pollCount).toBe(0);
    expect(script.successCalls).toEqual([]);
    expect(script.failureCalls).toEqual([]);
  }, 30_000);

  it.for([
    [RUN_TARGET_MISSING, "target agent acme/gone not found"],
    [RUN_REFUSED, "run refused: gate said no"],
  ] as const)(
    "a %s start records ONE START_FAILED verdict with the deterministic reason",
    { timeout: 30_000 },
    async ([outcome, reason], testCtx) => {
      if (!envReady) return testCtx.skip();
      script.runStart = {
        outcome,
        executionId: "",
        trackingTimeoutMinutes: 60,
        failureReason: reason,
      };

      await runTick();
      expect(script.failureCalls).toEqual([
        { scheduleId: "sch_tick", reason, kind: FAILURE_START_FAILED },
      ]);
      expect(script.successCalls).toEqual([]);
      expect(script.pollCount).toBe(0);
    },
  );

  it("a SKIPPED run start ends the tick quietly", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.runStart = {
      outcome: RUN_SKIPPED,
      executionId: "",
      trackingTimeoutMinutes: 60,
      failureReason: "",
    };
    await runTick();
    expect(script.failureCalls).toEqual([]);
    expect(script.pollCount).toBe(0);
  }, 30_000);

  it("tracks a started run to COMPLETED and resets the streak", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.pollResults = [PHASE_COMPLETED];

    await runTick();
    expect(script.pollCount).toBe(1);
    expect(script.successCalls).toEqual(["sch_tick"]);
    expect(script.failureCalls).toEqual([]);
  }, 30_000);

  it("re-polls a still-RUNNING run through the backoff sleep to its verdict", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    // Two polls with one real cycle-1 backoff (5s) between them — the
    // sleep→re-poll path the single-poll scenarios never execute.
    script.pollResults = [PHASE_RUNNING, PHASE_COMPLETED];

    await runTick();
    expect(script.pollCount).toBe(2);
    expect(script.successCalls).toEqual(["sch_tick"]);
    expect(script.failureCalls).toEqual([]);
  }, 30_000);

  it("an ALREADY_STARTED retry tracks exactly like STARTED", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.runStart = {
      outcome: RUN_ALREADY_STARTED,
      executionId: "aex_tick",
      trackingTimeoutMinutes: 60,
      failureReason: "",
    };
    await runTick();
    expect(script.successCalls).toEqual(["sch_tick"]);
  }, 30_000);

  it("records the 'run X ended failed' verdict on a FAILED phase", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.pollResults = [PHASE_FAILED];

    await runTick();
    expect(script.failureCalls).toEqual([
      {
        scheduleId: "sch_tick",
        reason: "run aex_tick ended failed",
        kind: FAILURE_RUN_FAILED,
      },
    ]);
    expect(script.successCalls).toEqual([]);
  }, 30_000);

  it("GONE yields no verdict (a deleted run must not brick its schedule)", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.pollResults = [PHASE_GONE];

    await runTick();
    expect(script.successCalls).toEqual([]);
    expect(script.failureCalls).toEqual([]);
  }, 30_000);

  it("budget exhaustion records RUN_TIMED_OUT with the byte-pinned reason (run NOT cancelled)", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    // A zero-minute budget: the deadline passes after the first RUNNING
    // poll (the poll-first loop never sleeps past its own deadline).
    script.runStart = {
      outcome: RUN_STARTED,
      executionId: "aex_tick",
      trackingTimeoutMinutes: 0,
      failureReason: "",
    };
    script.pollResults = [PHASE_RUNNING];

    await runTick();
    expect(script.pollCount).toBe(1);
    expect(script.failureCalls).toEqual([
      {
        scheduleId: "sch_tick",
        reason: "run aex_tick did not finish within 0 minutes",
        kind: FAILURE_RUN_TIMED_OUT,
      },
    ]);
  }, 30_000);

  it("a poll failure past retries fails the tick with NO verdict", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.pollError = "db unreachable";

    await expect(runTick()).rejects.toThrow();
    expect(script.successCalls).toEqual([]);
    expect(script.failureCalls).toEqual([]);
  }, 30_000);

  it("a record-tick failure fails the tick before any run start", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.tickError = "row unreadable";

    await expect(runTick()).rejects.toThrow();
    expect(script.pollCount).toBe(0);
    expect(script.failureCalls).toEqual([]);
  }, 30_000);

  it("derives the nominal fire time from the workflow-id suffix (tier 2)", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.tickOutcome = TICK_SKIPPED_DISABLED;

    await runTick({ workflowId: "schedule/tick/sch_tick-2026-08-25T09:30:00Z" });
    expect(script.recordTickArgs[0]?.nominal).toBe("2026-08-25T09:30:00Z");
  }, 30_000);

  it("falls back to workflow time truncated to whole seconds (tier 3)", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.tickOutcome = TICK_SKIPPED_DISABLED;

    await runTick();
    const nominal = script.recordTickArgs[0]?.nominal ?? "";
    // RFC-3339, whole seconds, UTC — the fire-identity format.
    expect(nominal).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  }, 30_000);
});

describe("tick loop bounds (plain unit)", () => {
  it("pins MAX_TRACKING_CYCLES at 240 (the recorded-history backstop)", () => {
    expect(MAX_TRACKING_CYCLES).toBe(240);
  });

  it("pins the tracking backoff curve: linear cycle×5s, capped at 60s by cycle twelve", () => {
    expect(trackingBackoffMs(1)).toBe(5_000);
    expect(trackingBackoffMs(2)).toBe(10_000);
    expect(trackingBackoffMs(11)).toBe(55_000);
    expect(trackingBackoffMs(12)).toBe(60_000);
    expect(trackingBackoffMs(13)).toBe(60_000);
    expect(trackingBackoffMs(240)).toBe(60_000);
  });
});

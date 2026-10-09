/**
 * Grade-run workflow orchestration tests, through a TestWorkflowEnvironment
 * with scripted activities (the schedule tick's precedent,
 * temporal/schedule/__tests__/tick-workflow.temporal.test.ts).
 *
 * What these pin (the grading workflow's contract):
 *   - a run is graded by the grade activity, whose outcome is the
 *     workflow's, and nothing records it as not graded;
 *   - when grading fails for good (a non-retryable failure here, the same
 *     path as exhausted retries) the run is recorded as not graded with
 *     the byte-pinned reason, never left without a score;
 *   - a cancelled grading is not swallowed into a not-graded record: the
 *     workflow ends cancelled;
 *   - after run health, the AI judge's branch: nothing more when the
 *     planner finds nothing to grade; a judge run that ends is recorded
 *     with no failure; a refused start is recorded with its failure; a
 *     start the platform keeps refusing for capacity is recorded "busy";
 *     any other start failure "not-started"; every judge that started or
 *     failed to start is recorded once, so its reservation is settled and
 *     its session deleted;
 *   - a history recorded by the workflow as it was before the judge
 *     (__fixtures__/grade-run-before-judge) replays against today's.
 *
 * Needs the `temporal` CLI on PATH (TestWorkflowEnvironment.createLocal);
 * every test skips VISIBLY when the local test server cannot start, never
 * a vacuous green.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  GRADE_ALREADY_GRADED,
  GRADE_RECORDED,
  GRADE_RUN_WORKFLOW_TYPE,
  GRADING_FAILED_REASON,
  JUDGE_BUSY_FAILURE_TYPE,
  type GradeOutcome,
  type GradingActivities,
  type JudgeActivities,
  type JudgeFailure,
  type JudgePlan,
  type JudgeStart,
  type JudgeTicket,
} from "../names.js";

const TASK_QUEUE = "grade-run-workflow-test";
const WORKFLOWS_PATH = new URL("../workflows/index.ts", import.meta.url)
  .pathname;
const BEFORE_JUDGE_QUEUE = "grade-run-before-judge-test";
const BEFORE_JUDGE_WORKFLOWS_PATH = new URL(
  "./__fixtures__/grade-run-before-judge/index.ts",
  import.meta.url,
).pathname;

const TICKET: JudgeTicket = { evaluatorId: "evl_test", modelName: "", capUsd: 0.25 };

type TestWorkflowEnvironment =
  import("@temporalio/testing").TestWorkflowEnvironment;
type Worker = import("@temporalio/worker").Worker;

let env: TestWorkflowEnvironment | null = null;
let worker: Worker | null = null;
let workerRunPromise: Promise<void> | null = null;
let envReady = false;

interface GradeScript {
  /** What the grade activity answers, or how it fails. */
  grade: GradeOutcome | "fail" | "hang";
  gradeCalls: string[];
  notGradedCalls: Array<{ runId: string; reason: string }>;
  /** What the judge's planner answers. */
  plan: JudgePlan;
  /** What the judge's start answers, or how it fails. */
  start: JudgeStart | "busy" | "broken";
  /** How many polls answer "still running" before one answers "ended". */
  pollsUntilEnded: number;
  polls: number;
  recordCalls: Array<{ runId: string; judgeRunId: string; failure: JudgeFailure }>;
}

let script: GradeScript;

// Releases a hung grade activity, so the worker can shut down once a test
// that cancelled its workflow is done with it.
let releaseHang: () => void = () => {};

function resetScript(): void {
  script = {
    grade: GRADE_RECORDED,
    gradeCalls: [],
    notGradedCalls: [],
    plan: { kind: "skip" },
    start: { kind: "started", judgeRunId: "run_judge" },
    pollsUntilEnded: 0,
    polls: 0,
    recordCalls: [],
  };
}
resetScript();

// Typed as the real activity surface, so a signature change flags these
// doubles at compile time.
function scriptedActivities(): GradingActivities & JudgeActivities {
  return {
    "stigmer/grading/plan-judge": async () => script.plan,
    "stigmer/grading/start-judge": async () => {
      const { ApplicationFailure } = await import("@temporalio/common");
      if (script.start === "busy") {
        // Non-retryable here so the test does not wait out ten minutes of
        // capacity retries; the workflow reads the same failure type.
        throw ApplicationFailure.create({
          message: "at capacity",
          type: JUDGE_BUSY_FAILURE_TYPE,
          nonRetryable: true,
        });
      }
      if (script.start === "broken") {
        throw ApplicationFailure.nonRetryable("the start broke");
      }
      return script.start;
    },
    "stigmer/grading/poll-judge": async () => {
      script.polls++;
      return script.polls > script.pollsUntilEnded;
    },
    "stigmer/grading/record-judge": async (runId, _ticket, judgeRunId, failure) => {
      script.recordCalls.push({ runId, judgeRunId, failure });
      return GRADE_RECORDED;
    },
    "stigmer/grading/grade-run-health": async (runId) => {
      script.gradeCalls.push(runId);
      if (script.grade === "fail") {
        const { ApplicationFailure } = await import("@temporalio/common");
        throw ApplicationFailure.nonRetryable("grading broke");
      }
      if (script.grade === "hang") {
        await new Promise<void>((resolve) => {
          releaseHang = resolve;
        });
        return GRADE_RECORDED;
      }
      return script.grade;
    },
    "stigmer/grading/record-not-graded": async (runId, reason) => {
      script.notGradedCalls.push({ runId, reason });
      return GRADE_RECORDED;
    },
  };
}

let workflowSeq = 0;

function startGradeRun(runId: string) {
  if (!env) throw new Error("TestWorkflowEnvironment not initialized");
  workflowSeq++;
  return env.client.workflow.start(GRADE_RUN_WORKFLOW_TYPE, {
    taskQueue: TASK_QUEUE,
    workflowId: `grade-run-test-${workflowSeq}-${Date.now()}`,
    args: [runId],
  });
}

describe("stigmer/grading/grade-run workflow (TestWorkflowEnvironment)", () => {
  beforeAll(async () => {
    try {
      const { TestWorkflowEnvironment: TWE } =
        await import("@temporalio/testing");
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

  it("grades the run and answers the grade's outcome", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.grade = GRADE_ALREADY_GRADED;
    const handle = await startGradeRun("run_graded");
    expect(await handle.result()).toBe(GRADE_ALREADY_GRADED);
    expect(script.gradeCalls).toEqual(["run_graded"]);
    expect(script.notGradedCalls).toEqual([]);
  }, 30_000);

  it("records the run as not graded when grading fails for good", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.grade = "fail";
    const handle = await startGradeRun("run_broken");
    expect(await handle.result()).toBe(GRADE_RECORDED);
    expect(script.notGradedCalls).toEqual([
      { runId: "run_broken", reason: GRADING_FAILED_REASON },
    ]);
  }, 30_000);

  it("ends cancelled when cancelled, without recording the run as not graded", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.grade = "hang";
    const handle = await startGradeRun("run_cancelled");
    for (let i = 0; i < 100 && script.gradeCalls.length === 0; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    await handle.cancel();
    const { WorkflowFailedError } = await import("@temporalio/client");
    const { CancelledFailure } = await import("@temporalio/common");
    const failure = await handle.result().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(WorkflowFailedError);
    expect(
      (failure as InstanceType<typeof WorkflowFailedError>).cause,
    ).toBeInstanceOf(CancelledFailure);
    expect(script.notGradedCalls).toEqual([]);
    releaseHang();
  }, 30_000);

  it("asks the judge's planner after run health and does nothing more when there is nothing to grade", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    const handle = await startGradeRun("run_ungraded");
    expect(await handle.result()).toBe(GRADE_RECORDED);
    expect(script.polls).toBe(0);
    expect(script.recordCalls).toEqual([]);
  }, 30_000);

  it("records a judge run that ended, with no failure, after polling it", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.plan = { kind: "grade", ticket: TICKET };
    script.pollsUntilEnded = 1;
    const handle = await startGradeRun("run_judged");
    expect(await handle.result(), "run health's outcome stays the result").toBe(GRADE_RECORDED);
    expect(script.polls).toBe(2);
    expect(script.recordCalls).toEqual([
      { runId: "run_judged", judgeRunId: "run_judge", failure: "" },
    ]);
  }, 60_000);

  it("records a refused start with its failure, without polling", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.plan = { kind: "grade", ticket: TICKET };
    script.start = { kind: "refused", failure: "out-of-credit" };
    const handle = await startGradeRun("run_no_credit");
    await handle.result();
    expect(script.polls).toBe(0);
    expect(script.recordCalls).toEqual([
      { runId: "run_no_credit", judgeRunId: "", failure: "out-of-credit" },
    ]);
  }, 30_000);

  it("records a start refused for capacity past its retries as busy, and any other failed start as not started", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.plan = { kind: "grade", ticket: TICKET };
    script.start = "busy";
    await (await startGradeRun("run_busy")).result();
    script.start = "broken";
    await (await startGradeRun("run_broken_start")).result();
    expect(script.recordCalls).toEqual([
      { runId: "run_busy", judgeRunId: "", failure: "busy" },
      { runId: "run_broken_start", judgeRunId: "", failure: "not-started" },
    ]);
  }, 30_000);

  it("records nothing for a grade the planner already recorded (the limit refused it)", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.plan = { kind: "recorded" };
    await (await startGradeRun("run_over_limit")).result();
    expect(script.recordCalls).toEqual([]);
  }, 30_000);

  it("replays a history recorded before the judge existed", async (testCtx) => {
    if (!envReady || env === null) return testCtx.skip();
    const { Worker: W } = await import("@temporalio/worker");
    const before = await W.create({
      connection: env.nativeConnection,
      taskQueue: BEFORE_JUDGE_QUEUE,
      workflowsPath: BEFORE_JUDGE_WORKFLOWS_PATH,
      activities: scriptedActivities(),
    });
    const handle = await env.client.workflow.start(GRADE_RUN_WORKFLOW_TYPE, {
      taskQueue: BEFORE_JUDGE_QUEUE,
      workflowId: `grade-run-before-judge-${Date.now()}`,
      args: ["run_before_judge"],
    });
    await before.runUntil(handle.result());
    const history = await handle.fetchHistory();
    await expect(
      W.runReplayHistory({ workflowsPath: WORKFLOWS_PATH }, history),
    ).resolves.toBeUndefined();
  }, 60_000);
});

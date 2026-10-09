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
 *     workflow ends cancelled.
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
  type GradeOutcome,
  type GradingActivities,
} from "../names.js";

const TASK_QUEUE = "grade-run-workflow-test";
const WORKFLOWS_PATH = new URL("../workflows/index.ts", import.meta.url)
  .pathname;

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
}

let script: GradeScript;

// Releases a hung grade activity, so the worker can shut down once a test
// that cancelled its workflow is done with it.
let releaseHang: () => void = () => {};

function resetScript(): void {
  script = { grade: GRADE_RECORDED, gradeCalls: [], notGradedCalls: [] };
}
resetScript();

// Typed as the real activity surface, so a signature change flags these
// doubles at compile time.
function scriptedActivities(): GradingActivities {
  return {
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
});

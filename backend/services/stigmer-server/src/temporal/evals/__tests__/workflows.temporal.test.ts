/**
 * The eval workflows through a TestWorkflowEnvironment, with scripted
 * activities (the grading workflow's precedent,
 * temporal/grading/__tests__/grade-run-workflow.temporal.test.ts), so the
 * real bundle, real child workflows and real cancellation run.
 *
 * What these pin:
 *   - every cell runs as a child `stigmer/evals/run-case` under its own
 *     id, each try graded with three votes per AI-graded check, every
 *     result recorded, and the eval ends completed;
 *   - at most `concurrency` children are in flight;
 *   - once the finished tries' cost reaches the limit no cell starts and
 *     the eval ends partial, "cost_ceiling";
 *   - a credit refusal ends the eval partial, "out_of_credit";
 *   - cancelling the eval stops the try in flight, records it not graded,
 *     "cancelled", and ends the eval partial, "cancelled";
 *   - a cancel arriving while a try's start activity runs waits for the
 *     start, then stops the run it created: no run is left going;
 *   - a case workflow that meets an error of its own (a grade it cannot
 *     read) fails, rather than retrying its task for ever: the suite
 *     records that try not graded and the eval ends.
 *
 * Needs the `temporal` CLI on PATH (TestWorkflowEnvironment.createLocal);
 * every test skips VISIBLY when the local test server cannot start, never
 * a vacuous green.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  RUN_PLUGIN_EVAL_WORKFLOW_TYPE,
  TRY_FAILED_REASON,
  runPluginEvalWorkflowId,
  type CaseActivities,
  type TryResult,
  type SpendActivities,
  type SuiteActivities,
  type SuiteCell,
  type SuiteEnd,
  type SuitePlan,
} from "../names.js";

const TASK_QUEUE = "plugin-eval-workflow-test";
const WORKFLOWS_PATH = new URL("../workflows/index.ts", import.meta.url)
  .pathname;

type TestWorkflowEnvironment =
  import("@temporalio/testing").TestWorkflowEnvironment;
type Worker = import("@temporalio/worker").Worker;

let env: TestWorkflowEnvironment | null = null;
let worker: Worker | null = null;
let workerRunPromise: Promise<void> | null = null;
let envReady = false;

interface Script {
  plan: SuitePlan;
  /** What each try costs. */
  costUsd: number;
  /** The try number (1-based, in start order) the credit refuses. */
  refuseCreditAt: number;
  /** Polls answer "running" for ever, until the run is stopped. */
  hang: boolean;
  /** How long each try's start takes, in milliseconds. */
  startDelayMs: number;
  /** Whether the case has an AI-graded check (each vote costs a poll's wait). */
  judged: boolean;
  /** Whether the grade answers `{}`, a shape the case workflow cannot read. */
  unreadableGrade: boolean;
  starts: string[];
  inFlight: number;
  most: number;
  votes: number;
  recorded: Array<{ cell: SuiteCell; result: TryResult }>;
  finished: SuiteEnd[];
  stopped: string[];
}

let script: Script;

function cells(count: number): SuiteCell[] {
  return Array.from({ length: count }, (_, index) => ({
    caseIndex: 0,
    targetIndex: 0,
    arm: index % 2 === 0 ? ("with" as const) : ("without" as const),
    tryIndex: Math.floor(index / 2),
    timeoutSeconds: 600,
  }));
}

function resetScript(): void {
  script = {
    plan: {
      kind: "run",
      org: "acme",
      cells: cells(4),
      maxCostUsd: 10,
      concurrency: 1,
    },
    costUsd: 0.1,
    refuseCreditAt: 0,
    hang: false,
    startDelayMs: 0,
    judged: false,
    unreadableGrade: false,
    starts: [],
    inFlight: 0,
    most: 0,
    votes: 0,
    recorded: [],
    finished: [],
    stopped: [],
  };
}
resetScript();

// Typed as the real activity surfaces, so a signature change flags these
// doubles at compile time.
function scriptedActivities(): SuiteActivities &
  CaseActivities &
  SpendActivities {
  return {
    "stigmer/evals/try-spend": async () => ({
      sessionId: "",
      runId: "",
      costUsd: 0,
    }),
    "stigmer/evals/load-suite": async () => script.plan,
    "stigmer/evals/record-try": async (_evalId, cell, result) => {
      script.recorded.push({ cell, result });
    },
    "stigmer/evals/finish-eval": async (_evalId, end) => {
      script.finished.push(end);
    },
    "stigmer/evals/start-try": async (input) => {
      const n = script.starts.length + 1;
      script.starts.push(`${input.arm}/${input.tryIndex}`);
      if (script.startDelayMs > 0) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, script.startDelayMs),
        );
      }
      if (n === script.refuseCreditAt) {
        return {
          kind: "refused",
          failure: "out-of-credit",
          reason: "out of credit",
        };
      }
      script.inFlight++;
      script.most = Math.max(script.most, script.inFlight);
      return { kind: "started", sessionId: `ses_${n}`, runId: `run_${n}` };
    },
    "stigmer/evals/poll-run": async (runId) => {
      if (script.hang && !script.stopped.includes(runId)) {
        return { phase: "running", startedAtMs: 0 };
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      return { phase: "ended", startedAtMs: 0 };
    },
    "stigmer/evals/stop-run": async (runId) => {
      script.stopped.push(runId);
    },
    "stigmer/evals/grade-try": async () => {
      script.inFlight--;
      if (script.unreadableGrade) {
        // A defect's answer: not the TryGrade the signature promises.
        return {} as Awaited<ReturnType<CaseActivities["stigmer/evals/grade-try"]>>;
      }
      return {
        outcomes: script.judged
          ? [{ votes: "criteria" }, { passed: true, reason: "found" }]
          : [{ passed: true, reason: "found" }],
        error: "",
        costUsd: script.costUsd,
        durationSeconds: 1,
      };
    },
    "stigmer/evals/start-vote": async (
      _input,
      runId,
      graderIndex,
      voteIndex,
    ) => {
      script.votes++;
      return {
        kind: "started",
        voteRunId: `${runId}_vote_${graderIndex}_${voteIndex}`,
      };
    },
    "stigmer/evals/read-vote": async () => ({
      vote: { kind: "vote", passed: true, reason: "yes" },
      costUsd: 0,
    }),
    "stigmer/evals/delete-vote": async () => {},
    "stigmer/evals/record-score": async (_input, started, grade) => ({
      sessionId: started.sessionId,
      runId: started.runId,
      state: "graded",
      score: 1,
      notGradedReason: "",
      error: grade.error,
      costUsd: grade.costUsd,
      durationSeconds: grade.durationSeconds,
      outOfCredit: false,
    }),
  };
}

let workflowSeq = 0;

function startEval() {
  if (!env) throw new Error("TestWorkflowEnvironment not initialized");
  workflowSeq++;
  const evalId = `pev_test${workflowSeq}${Date.now()}`;
  return env.client.workflow.start(RUN_PLUGIN_EVAL_WORKFLOW_TYPE, {
    taskQueue: TASK_QUEUE,
    workflowId: runPluginEvalWorkflowId(evalId),
    args: [{ evalId }],
  });
}

describe("stigmer/evals/run-plugin-eval workflow (TestWorkflowEnvironment)", () => {
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

  it("runs every cell as a child, votes three times per AI-graded check, and ends completed", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.judged = true;
    script.plan = {
      kind: "run",
      org: "acme",
      cells: cells(2),
      maxCostUsd: 10,
      concurrency: 2,
    };
    const handle = await startEval();
    await handle.result();
    expect([...script.starts].sort()).toEqual(["with/0", "without/0"]);
    expect(script.votes).toBe(6);
    expect(script.recorded).toHaveLength(2);
    expect(
      script.recorded.every(({ result }) => result.state === "graded"),
    ).toBe(true);
    expect(script.finished).toEqual([{ phase: "completed" }]);
  }, 60_000);

  it("keeps at most concurrency children in flight", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.plan = {
      kind: "run",
      org: "acme",
      cells: cells(4),
      maxCostUsd: 10,
      concurrency: 2,
    };
    const handle = await startEval();
    await handle.result();
    expect(script.recorded).toHaveLength(4);
    expect(script.most).toBeLessThanOrEqual(2);
    expect(script.most).toBe(2);
  }, 60_000);

  it("starts no cell once the spending limit is reached, and ends partial", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.plan = {
      kind: "run",
      org: "acme",
      cells: cells(4),
      maxCostUsd: 0.25,
      concurrency: 1,
    };
    const handle = await startEval();
    await handle.result();
    expect(script.recorded).toHaveLength(3);
    expect(script.finished).toEqual([
      { phase: "partial", reason: "cost_ceiling" },
    ]);
  }, 60_000);

  it("ends partial when the organization's credit refuses a try", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.refuseCreditAt = 2;
    const handle = await startEval();
    await handle.result();
    expect(script.recorded).toHaveLength(2);
    expect(script.recorded[1]?.result).toMatchObject({
      state: "not-graded",
      outOfCredit: true,
    });
    expect(script.finished).toEqual([
      { phase: "partial", reason: "out_of_credit" },
    ]);
  }, 60_000);

  it("stops the try in flight and ends partial when cancelled", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.hang = true;
    const handle = await startEval();
    for (let i = 0; i < 200 && script.starts.length === 0; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    await handle.cancel();
    const failure = await handle.result().then(
      () => undefined,
      (error: unknown) => error,
    );
    const { WorkflowFailedError } = await import("@temporalio/client");
    expect(failure).toBeInstanceOf(WorkflowFailedError);
    expect(script.stopped).toEqual(["run_1"]);
    expect(script.finished).toEqual([
      { phase: "partial", reason: "cancelled" },
    ]);
    expect(script.recorded).toEqual([
      {
        cell: expect.objectContaining({ arm: "with", tryIndex: 0 }),
        result: expect.objectContaining({
          sessionId: "ses_1",
          runId: "run_1",
          state: "not-graded",
          notGradedReason: "cancelled",
        }),
      },
    ]);
  }, 60_000);

  it("leaves no run going when the cancel arrives while a try's start runs", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.hang = true;
    script.startDelayMs = 1_500;
    const handle = await startEval();
    for (let i = 0; i < 200 && script.starts.length === 0; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    await handle.cancel();
    const failure = await handle.result().then(
      () => undefined,
      (error: unknown) => error,
    );
    const { WorkflowFailedError } = await import("@temporalio/client");
    expect(failure).toBeInstanceOf(WorkflowFailedError);
    expect(script.starts).toEqual(["with/0"]);
    expect(script.stopped, "the run the start created is stopped").toEqual([
      "run_1",
    ]);
    expect(script.recorded.map(({ result }) => result)).toEqual([
      expect.objectContaining({
        runId: "run_1",
        notGradedReason: "cancelled",
      }),
    ]);
    expect(script.finished).toEqual([
      { phase: "partial", reason: "cancelled" },
    ]);
  }, 60_000);

  it("fails a case workflow that cannot read its grade, records that try not graded, and ends the eval", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.unreadableGrade = true;
    script.plan = {
      kind: "run",
      org: "acme",
      cells: cells(2),
      maxCostUsd: 10,
      concurrency: 1,
    };
    const handle = await startEval();
    await handle.result();
    expect(script.recorded.map(({ result }) => result)).toEqual([
      expect.objectContaining({ state: "not-graded", notGradedReason: TRY_FAILED_REASON }),
      expect.objectContaining({ state: "not-graded", notGradedReason: TRY_FAILED_REASON }),
    ]);
    expect(script.finished).toHaveLength(1);
  }, 60_000);
});

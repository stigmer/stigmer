/**
 * Golden YAML E2E tests using Temporal TestWorkflowEnvironment.
 *
 * These tests run the full Temporal workflow lifecycle:
 * - Workflow bundling into the Temporal deterministic sandbox
 * - Activity scheduling via proxyActivities/proxyLocalActivities
 * - Expression evaluation via local activities (jq-wasm)
 * - Timer handling (sleep/wait)
 *
 * Prerequisites: none beyond `npm install`. `TestWorkflowEnvironment.createTimeSkipping()`
 * downloads and runs Temporal's own test server, which skips a timer as soon as
 * the workflow waits on it, so the goldens that wait minutes (#16 wait-delay,
 * #21 retry-backoff) finish inside the per-test budget.
 *
 * The workflow-engine uses `deepClone` from `clone.ts` which falls
 * back to JSON round-trip when `structuredClone` is unavailable in
 * the Temporal deterministic V8 sandbox.
 *
 * Only one failure skips: the Temporal test server cannot boot (no network
 * for the download, say). Each golden then skips by name with the boot
 * error. Anything after the boot (the worker, the workflow bundle, a
 * golden itself) fails. The suite once swallowed every error and returned
 * early from each test, which vitest counts as a pass, so it reported
 * sixteen passes without running a golden (stigmer#1300).
 *
 * Run with: npx vitest run src/__tests__/golden-e2e.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkflowFromYaml } from "../workflow-engine/loader.js";
import { evaluateExpressionBatch } from "../workflow-engine/expression.js";
import type { EngineActivities, ExecuteServerlessWorkflowInput } from "../workflows/engine-core.js";
import type { WorkflowModel } from "../workflow-engine/types.js";
import { INLINE_MODEL_WORKFLOW_TYPE } from "../__test-utils__/workflows/inline-model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(__dirname, "../../test/golden");
const WORKFLOWS_PATH = join(__dirname, "../__test-utils__/workflows/index.ts");
const TASK_QUEUE = "golden-e2e-test";

function loadGolden(filename: string): string {
  return readFileSync(join(GOLDEN_DIR, filename), "utf-8");
}

function fakeHttpResponse(body: unknown = {}): unknown {
  return { id: 1, title: "response", body: "ok", userId: 7, ...body as object };
}

type TestWorkflowEnvironment = import("@temporalio/testing").TestWorkflowEnvironment;
type Worker = import("@temporalio/worker").Worker;

let env: TestWorkflowEnvironment | null = null;
let worker: Worker | null = null;
let workerRunPromise: Promise<void> | null = null;
/** Why the Temporal test server could not boot; `null` once it has. */
let bootError: string | null = "not attempted";

function createMockActivities() {
  return {
    EvaluateExpressions: async (
      expressions: Record<string, string>,
      input: unknown,
      stateVars: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      return evaluateExpressionBatch(expressions, input, stateVars);
    },
    CallHttp: async (): Promise<unknown> => fakeHttpResponse(),
    CallGrpc: async (): Promise<unknown> => ({ result: "grpc-response" }),
    CallFunction: async (
      call: string,
      config: Record<string, unknown>,
    ): Promise<unknown> => {
      if (call === "emit_event") {
        const event = config.event as Record<string, unknown>;
        return { specversion: "1.0", type: event?.type ?? "unknown", data: event?.data, id: `evt-${Date.now()}` };
      }
      if (call === "notification") return { delivered: true, channel: "webhook" };
      return { result: `function-${call}` };
    },
    CallAgent: async (): Promise<unknown> => ({
      structured: { severity: "low", category: "style", customer_impact: false },
    }),
    RunScript: async (): Promise<unknown> => ({ computed: 4 }),
    RunShell: async (): Promise<unknown> => "hello from shell",
    UpdateWorkflowTaskApprovalStatus: async (): Promise<boolean> => false,
    ClearWorkflowApprovalStatus: async (): Promise<void> => {},
    UpdateWorkflowFileReviewStatus: async (): Promise<void> => {},
    GetAwaitingFileReviewChangeSetIds: async (): Promise<string[]> => [],
    GetAgentExecutionProgress: async (): Promise<null> => null,
    ResetEventSequence: async (): Promise<number> => 0,
    EmitWorkflowEvents: async (): Promise<void> => {},
    LoadRecoveryContext: async (): Promise<unknown[]> => [],
    PromoteTaskOutput: async (): Promise<void> => {},
  } satisfies Record<keyof EngineActivities, unknown>;
}

async function runGoldenWorkflow(model: WorkflowModel, workflowInput: unknown = null): Promise<unknown> {
  if (!env) throw new Error("TestWorkflowEnvironment not initialized");
  const input: ExecuteServerlessWorkflowInput = {
    model,
    workflow_input: workflowInput,
    env: {},
    metadata: { execution_id: "e2e-test" },
  };
  return env.client.workflow.execute(INLINE_MODEL_WORKFLOW_TYPE, {
    taskQueue: TASK_QUEUE,
    workflowId: `golden-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    args: [input],
    // Workflow time, which the test server skips through: #16 alone waits 96s of
    // timers. Real time stays bounded by vitest's per-test timeout.
    workflowExecutionTimeout: "10m",
  });
}

describe("Golden E2E — Temporal TestWorkflowEnvironment", () => {
  beforeAll(async () => {
    const { TestWorkflowEnvironment: TWE } = await import("@temporalio/testing");
    const { Worker: W } = await import("@temporalio/worker");

    try {
      env = await TWE.createTimeSkipping();
    } catch (err: unknown) {
      bootError = err instanceof Error ? err.message : String(err);
      console.warn(`Temporal test server cannot boot; every golden skips: ${bootError}`);
      return;
    }
    bootError = null;

    // Past the boot, a failure is the suite's to report, not to skip.
    worker = await W.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: WORKFLOWS_PATH,
      activities: createMockActivities(),
    });
    workerRunPromise = worker.run();
  }, 60_000);

  afterAll(async () => {
    if (worker) {
      worker.shutdown();
      await workerRunPromise?.catch(() => {});
    }
    if (env) await env.teardown();
  }, 30_000);

  // ─────────────────────────────────────────────────────────────────
  // Each golden skips by name when the test server could not boot.
  // ─────────────────────────────────────────────────────────────────

  it("#01 operation-basic — sequential set tasks", async (testCtx) => {
    if (bootError !== null) return testCtx.skip(`Temporal test server cannot boot: ${bootError}`);
    const model = loadWorkflowFromYaml(loadGolden("01-operation-basic.yaml"));
    const result = await runGoldenWorkflow(model);
    expect(result).toEqual({ workflow_completed: true });
  });

  it("#14 try-catch-raise — error handling pipeline", async (testCtx) => {
    if (bootError !== null) return testCtx.skip(`Temporal test server cannot boot: ${bootError}`);
    const model = loadWorkflowFromYaml(loadGolden("14-try-catch-raise.yaml"));
    const result = await runGoldenWorkflow(model);
    expect(result).toEqual({ phase: "completed" });
  });

  it("#15 fork-parallel — non-compete branches", async (testCtx) => {
    if (bootError !== null) return testCtx.skip(`Temporal test server cannot boot: ${bootError}`);
    const model = loadWorkflowFromYaml(loadGolden("15-fork-parallel.yaml"));
    const result = await runGoldenWorkflow(model);
    expect(result).toBeDefined();
  });

  it("#02 switch-conditional — HTTP + conditional branching", async (testCtx) => {
    if (bootError !== null) return testCtx.skip(`Temporal test server cannot boot: ${bootError}`);
    const model = loadWorkflowFromYaml(loadGolden("02-switch-conditional.yaml"));
    const result = await runGoldenWorkflow(model);
    expect(result).toBeDefined();
  });

  it("#03 foreach-loop — iteration with HTTP calls", async (testCtx) => {
    if (bootError !== null) return testCtx.skip(`Temporal test server cannot boot: ${bootError}`);
    const model = loadWorkflowFromYaml(loadGolden("03-foreach-loop.yaml"));
    const result = await runGoldenWorkflow(model, { items: ["a", "b", "c"] });
    expect(result).toBeDefined();
  });

  it("#04 parallel-concurrent — fork with HTTP branches", async (testCtx) => {
    if (bootError !== null) return testCtx.skip(`Temporal test server cannot boot: ${bootError}`);
    const model = loadWorkflowFromYaml(loadGolden("04-parallel-concurrent.yaml"));
    const result = await runGoldenWorkflow(model);
    expect(result).toBeDefined();
  });

  it("#06 sleep-delay — wait + HTTP calls", async (testCtx) => {
    if (bootError !== null) return testCtx.skip(`Temporal test server cannot boot: ${bootError}`);
    const model = loadWorkflowFromYaml(loadGolden("06-sleep-delay.yaml"));
    const result = await runGoldenWorkflow(model);
    expect(result).toBeDefined();
  });

  it("#07 inject-transform — expressions + HTTP", async (testCtx) => {
    if (bootError !== null) return testCtx.skip(`Temporal test server cannot boot: ${bootError}`);
    const model = loadWorkflowFromYaml(loadGolden("07-inject-transform.yaml"));
    const result = await runGoldenWorkflow(model, { a: 10, b: 20 });
    expect(result).toBeDefined();
  });

  it("#08 error-retry — try/catch with HTTP", async (testCtx) => {
    if (bootError !== null) return testCtx.skip(`Temporal test server cannot boot: ${bootError}`);
    const model = loadWorkflowFromYaml(loadGolden("08-error-retry.yaml"));
    const result = await runGoldenWorkflow(model);
    expect(result).toBeDefined();
  });

  it("#11 claimcheck-large-payload — sequential HTTP calls", async (testCtx) => {
    if (bootError !== null) return testCtx.skip(`Temporal test server cannot boot: ${bootError}`);
    const model = loadWorkflowFromYaml(loadGolden("11-claimcheck-large-payload.yaml"));
    const result = await runGoldenWorkflow(model);
    expect(result).toBeDefined();
  });

  it("#12 claimcheck-between-steps — HTTP chain", async (testCtx) => {
    if (bootError !== null) return testCtx.skip(`Temporal test server cannot boot: ${bootError}`);
    const model = loadWorkflowFromYaml(loadGolden("12-claimcheck-between-steps.yaml"));
    const result = await runGoldenWorkflow(model);
    expect(result).toBeDefined();
  });

  it("#16 wait-delay — timer durations", async (testCtx) => {
    if (bootError !== null) return testCtx.skip(`Temporal test server cannot boot: ${bootError}`);
    const model = loadWorkflowFromYaml(loadGolden("16-wait-delay.yaml"));
    const result = await runGoldenWorkflow(model);
    expect(result).toEqual({ completed: true });
  });

  // quarantined: stigmer#1322 — `run.workflow` starts its child by the workflow's
  // name, which no worker registers; the kind is refused at save until that issue
  // lands, and this golden is its end-to-end reproduction.
  it.skip("#18 run-task — script + shell + workflow", async (testCtx) => {
    if (bootError !== null) return testCtx.skip(`Temporal test server cannot boot: ${bootError}`);
    const model = loadWorkflowFromYaml(loadGolden("18-run-task.yaml"));
    const result = await runGoldenWorkflow(model);
    expect(result).toEqual({ all_runs_done: true });
  });

  it("#19 emit-event — CloudEvents envelope", async (testCtx) => {
    if (bootError !== null) return testCtx.skip(`Temporal test server cannot boot: ${bootError}`);
    const model = loadWorkflowFromYaml(loadGolden("19-emit-event.yaml"));
    const result = await runGoldenWorkflow(model);
    expect(result).toEqual({ events_emitted: true });
  });

  it("#21 retry-backoff — catch-level retry", async (testCtx) => {
    if (bootError !== null) return testCtx.skip(`Temporal test server cannot boot: ${bootError}`);
    const model = loadWorkflowFromYaml(loadGolden("21-retry-backoff.yaml"));
    const result = await runGoldenWorkflow(model);
    expect(result).toEqual({ phase: "completed" });
  });

  it("#23 notification — webhook notification", async (testCtx) => {
    if (bootError !== null) return testCtx.skip(`Temporal test server cannot boot: ${bootError}`);
    const model = loadWorkflowFromYaml(loadGolden("23-notification.yaml"));
    const result = await runGoldenWorkflow(model);
    expect(result).toEqual({ notifications_sent: true });
  });
});

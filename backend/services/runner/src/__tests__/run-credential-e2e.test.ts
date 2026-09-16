/**
 * The run credential end to end through a real Temporal
 * (`TestWorkflowEnvironment`, the golden E2E's harness): a credential on the
 * `execute-from-execution` workflow input reaches EVERY activity the run
 * schedules — the remote hydrate and the engine's local activities alike —
 * as the activity's current run credential, and a credential-less input
 * reaches none of them. This is the property the whole carrier exists for
 * (`shared/run-credential.ts`): no activity of a member's run ever runs as
 * the operator, and no activity of a credential-less run changes.
 *
 * Both ends are registered exactly as the worker roots register them: the
 * activity interceptor on the worker, the workflow interceptor module in the
 * bundle. Skipped, like the golden E2E, when a local Temporal cannot boot.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadWorkflowFromYaml } from "../workflow-engine/loader.js";
import { evaluateExpressionBatch } from "../workflow-engine/expression.js";
import type { ExecuteFromExecutionInput } from "../workflows/execute-from-execution.js";
import { EXECUTE_FROM_EXECUTION_WORKFLOW_TYPE } from "../workflows/execute-from-execution.js";
import { runCredentialActivityInterceptor } from "../interceptors/run-credential-activity.js";
import { currentRunCredential } from "../shared/run-credential-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_PATH = join(__dirname, "../workflows/index.ts");
const RUN_CREDENTIAL_WORKFLOW_INTERCEPTOR = join(
  __dirname,
  "../workflows/interceptors/run-credential.ts",
);
const GOLDEN_MODEL = readFileSync(
  join(__dirname, "../../test/golden/01-operation-basic.yaml"),
  "utf-8",
);
const TASK_QUEUE = "run-credential-e2e-test";

type TestWorkflowEnvironment =
  import("@temporalio/testing").TestWorkflowEnvironment;
type Worker = import("@temporalio/worker").Worker;

let env: TestWorkflowEnvironment | null = null;
let worker: Worker | null = null;
let workerRunPromise: Promise<void> | null = null;
let envReady = false;

/**
 * What each activity saw as its run credential, in the order they ran, with
 * the execution it was working on (the hydrate's input object; the engine's
 * positional first argument).
 */
const observed: Array<{
  activity: string;
  executionId: string;
  credential: string | undefined;
}> = [];

function observing<T extends (...args: never[]) => unknown>(
  activity: string,
  body: T,
): T {
  return ((...args: never[]) => {
    const first: unknown = args[0];
    const executionId =
      typeof first === "string"
        ? first
        : typeof first === "object" && first !== null && "execution_id" in first
          ? String((first as { execution_id: unknown }).execution_id)
          : "";
    observed.push({
      activity,
      executionId,
      credential: currentRunCredential(),
    });
    return body(...args);
  }) as T;
}

function createObservingActivities() {
  return {
    HydrateWorkflowExecution: observing(
      "HydrateWorkflowExecution",
      async (input: ExecuteFromExecutionInput) => ({
        model: loadWorkflowFromYaml(GOLDEN_MODEL),
        workflow_input: null,
        env: {},
        metadata: { execution_id: input.execution_id },
      }),
    ),
    ResetEventSequence: observing(
      "ResetEventSequence",
      async (): Promise<number> => 0,
    ),
    LoadRecoveryContext: observing(
      "LoadRecoveryContext",
      async (): Promise<unknown[]> => [],
    ),
    EmitWorkflowEvents: observing(
      "EmitWorkflowEvents",
      async (): Promise<void> => {},
    ),
    PromoteTaskOutput: observing(
      "PromoteTaskOutput",
      async (): Promise<void> => {},
    ),
    EvaluateExpressions: observing(
      "EvaluateExpressions",
      async (
        expressions: Record<string, string>,
        input: unknown,
        stateVars: Record<string, unknown>,
      ) => evaluateExpressionBatch(expressions, input, stateVars),
    ),
  };
}

async function runOnce(credential: string | undefined): Promise<string> {
  if (!env) throw new Error("TestWorkflowEnvironment not initialized");
  const executionId = `wex_e2e_${Math.random().toString(36).slice(2)}`;
  const input: ExecuteFromExecutionInput = {
    execution_id: executionId,
    workflow_instance_id: "wfi_1",
    workflow_id: "wf_1",
    org_id: "org_1",
    ...(credential !== undefined
      ? { execution_context_token: credential }
      : {}),
  };
  await env.client.workflow.execute(EXECUTE_FROM_EXECUTION_WORKFLOW_TYPE, {
    taskQueue: TASK_QUEUE,
    workflowId: `run-credential-e2e-${executionId}`,
    args: [input],
    workflowExecutionTimeout: "30s",
  });
  return executionId;
}

describe("run credential E2E — Temporal TestWorkflowEnvironment", () => {
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
        activities: createObservingActivities(),
        interceptors: {
          activity: [runCredentialActivityInterceptor],
          workflowModules: [RUN_CREDENTIAL_WORKFLOW_INTERCEPTOR],
        },
      });
      workerRunPromise = worker.run();
      await runOnce(undefined);
      observed.length = 0;
      envReady = true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `Temporal E2E smoke test failed (tests will be skipped): ${msg}`,
      );
      envReady = false;
    }
  }, 90_000);

  afterAll(async () => {
    if (worker) {
      worker.shutdown();
      await workerRunPromise;
    }
    await env?.teardown();
  });

  it("every activity of a run whose input carries a credential runs with that credential current", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    observed.length = 0;

    await runOnce("run-cred-e2e");

    const activities = new Set(observed.map((o) => o.activity));
    expect(activities).toContain("HydrateWorkflowExecution");
    expect(activities).toContain("ResetEventSequence");
    expect(activities).toContain("EmitWorkflowEvents");
    expect(observed.length).toBeGreaterThan(3);
    expect(
      observed.every((o) => o.credential === "run-cred-e2e"),
      JSON.stringify(observed),
    ).toBe(true);
  }, 60_000);

  it("no activity of a credential-less run sees a credential — an older server's dispatch is unchanged", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    observed.length = 0;

    await runOnce(undefined);

    expect(observed.length).toBeGreaterThan(3);
    expect(
      observed.every((o) => o.credential === undefined),
      JSON.stringify(observed),
    ).toBe(true);
  }, 60_000);

  it("two runs in flight at once each see their own credential", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    observed.length = 0;

    const [one, two] = await Promise.all([
      runOnce("run-cred-one"),
      runOnce("run-cred-two"),
    ]);
    const expected = new Map([
      [one, "run-cred-one"],
      [two, "run-cred-two"],
    ]);

    const identified = observed.filter((o) => o.executionId !== "");
    expect(identified.length).toBeGreaterThan(6);
    expect(new Set(identified.map((o) => o.executionId))).toEqual(
      new Set([one, two]),
    );
    for (const o of identified) {
      expect(o.credential, `${o.activity} on ${o.executionId}`).toBe(
        expected.get(o.executionId),
      );
    }
  }, 60_000);
});

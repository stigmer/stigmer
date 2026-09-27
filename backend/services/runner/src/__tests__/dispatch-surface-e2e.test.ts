/**
 * What a runner does with a workflow it was never meant to run, through a
 * real Temporal (`TestWorkflowEnvironment`, the golden E2E's harness).
 *
 * A client that can reach Temporal can start any workflow type on a
 * runner's queue, with any input. The runner's answer is its registered
 * set: the production barrel (`src/workflows/index.ts`), which every
 * worker root bundles, registers only types the server starts by id. This
 * file pins the consequence end to end, on a worker that loads that barrel
 * and the run-credential interceptors the way the roots do:
 *   - a start of `stigmer/workflow/execute` carrying a complete model never
 *     runs. Its workflow task fails because the type is unregistered, and no
 *     activity is ever scheduled, so the model's shell task never executes;
 *   - the same worker still runs `execute-from-execution`, the type the
 *     server does start, so the refusal is the barrel's and not a dead worker.
 *
 * The inline type's name is written out here on purpose: it is the removed
 * type, and this test is what keeps it removed at the wire. Skipped when a
 * local Temporal cannot boot.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadWorkflowFromYaml } from "../workflow-engine/loader.js";
import { evaluateExpressionBatch } from "../workflow-engine/expression.js";
import type { ExecuteServerlessWorkflowInput } from "../workflows/engine-core.js";
import type { ExecuteFromExecutionInput } from "../workflows/execute-from-execution.js";
import { EXECUTE_FROM_EXECUTION_WORKFLOW_TYPE } from "../workflows/execute-from-execution.js";
import { runCredentialActivityInterceptor } from "../interceptors/run-credential-activity.js";

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
const TASK_QUEUE = "dispatch-surface-e2e-test";
const REMOVED_INLINE_TYPE = "stigmer/workflow/execute";

const SHELL_MODEL = `
document:
  dsl: '1.0.0'
  namespace: dispatch-surface
  name: handed-model
  version: '1.0.0'
do:
  - runShell:
      run:
        shell:
          command: echo
          arguments:
            msg: "this must never run"
`;

type TestWorkflowEnvironment =
  import("@temporalio/testing").TestWorkflowEnvironment;
type Worker = import("@temporalio/worker").Worker;

let env: TestWorkflowEnvironment | null = null;
let worker: Worker | null = null;
let workerRunPromise: Promise<void> | null = null;
let envReady = false;

/** Every activity the worker ran, in order. */
const ran: string[] = [];

function recording<T extends (...args: never[]) => unknown>(
  activity: string,
  body: T,
): T {
  return ((...args: never[]) => {
    ran.push(activity);
    return body(...args);
  }) as T;
}

function createRecordingActivities() {
  return {
    HydrateWorkflowExecution: recording(
      "HydrateWorkflowExecution",
      async (input: ExecuteFromExecutionInput) => ({
        model: loadWorkflowFromYaml(GOLDEN_MODEL),
        workflow_input: null,
        env: {},
        metadata: { execution_id: input.execution_id },
      }),
    ),
    ResetEventSequence: recording("ResetEventSequence", async (): Promise<number> => 0),
    LoadRecoveryContext: recording("LoadRecoveryContext", async (): Promise<unknown[]> => []),
    EmitWorkflowEvents: recording("EmitWorkflowEvents", async (): Promise<void> => {}),
    PromoteTaskOutput: recording("PromoteTaskOutput", async (): Promise<void> => {}),
    EvaluateExpressions: recording(
      "EvaluateExpressions",
      async (
        expressions: Record<string, string>,
        input: unknown,
        stateVars: Record<string, unknown>,
      ) => evaluateExpressionBatch(expressions, input, stateVars),
    ),
    RunShell: recording("RunShell", async (): Promise<unknown> => ({ stdout: "" })),
    RunScript: recording("RunScript", async (): Promise<unknown> => ({ stdout: "" })),
  };
}

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("dispatch surface E2E — Temporal TestWorkflowEnvironment", () => {
  beforeAll(async () => {
    try {
      const { TestWorkflowEnvironment: TWE } = await import("@temporalio/testing");
      const { Worker: W } = await import("@temporalio/worker");

      env = await TWE.createLocal();
      worker = await W.create({
        connection: env.nativeConnection,
        taskQueue: TASK_QUEUE,
        workflowsPath: WORKFLOWS_PATH,
        activities: createRecordingActivities(),
        interceptors: {
          activity: [runCredentialActivityInterceptor],
          workflowModules: [RUN_CREDENTIAL_WORKFLOW_INTERCEPTOR],
        },
      });
      workerRunPromise = worker.run();
      envReady = true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Temporal E2E smoke test failed (tests will be skipped): ${msg}`);
      envReady = false;
    }
  }, 90_000);

  afterAll(async () => {
    if (worker) {
      worker.shutdown();
      await workerRunPromise?.catch(() => {});
    }
    await env?.teardown();
  });

  it("never runs a complete model started on its queue as the removed inline type", async (testCtx) => {
    if (!envReady || !env) return testCtx.skip();
    ran.length = 0;

    const input: ExecuteServerlessWorkflowInput = {
      model: loadWorkflowFromYaml(SHELL_MODEL),
      workflow_input: null,
      env: {},
    };
    const handle = await env.client.workflow.start(REMOVED_INLINE_TYPE, {
      taskQueue: TASK_QUEUE,
      workflowId: uniqueId("dispatch-surface-inline"),
      args: [input],
      workflowExecutionTimeout: "60s",
    });

    // The worker answers the first workflow task with a failure and the
    // workflow stays open. Poll the history until that failure appears, or
    // until the workflow closes (which only a worker that ran it can cause).
    const deadline = Date.now() + 30_000;
    let taskFailure: string | undefined;
    let scheduledActivities = 0;
    let running = true;
    while (Date.now() < deadline && taskFailure === undefined && running) {
      const history = await handle.fetchHistory();
      const events = history.events ?? [];
      scheduledActivities = events.filter((e) => e.activityTaskScheduledEventAttributes).length;
      const failed = events.find((e) => e.workflowTaskFailedEventAttributes);
      taskFailure = failed?.workflowTaskFailedEventAttributes?.failure?.message ?? undefined;
      running = (await handle.describe()).status.name === "RUNNING";
      if (taskFailure === undefined && running) await new Promise((r) => setTimeout(r, 200));
    }
    if (running) {
      await handle.terminate("dispatch-surface e2e: the removed type is never executed");
    }

    expect(ran, "no activity of the handed model may run").toEqual([]);
    expect(scheduledActivities).toBe(0);
    expect(running, "the workflow must stay open: nothing ran it").toBe(true);
    expect(taskFailure, "the workflow task must fail for the unregistered type").toBeDefined();
    expect(taskFailure).toContain(REMOVED_INLINE_TYPE);
  }, 60_000);

  it("still runs the type the server starts, on the same worker", async (testCtx) => {
    if (!envReady || !env) return testCtx.skip();
    ran.length = 0;

    const input: ExecuteFromExecutionInput = {
      execution_id: `wex_dispatch_${Math.random().toString(36).slice(2)}`,
      workflow_instance_id: "wfi_1",
      workflow_id: "wf_1",
      org_id: "org_1",
    };
    await env.client.workflow.execute(EXECUTE_FROM_EXECUTION_WORKFLOW_TYPE, {
      taskQueue: TASK_QUEUE,
      workflowId: uniqueId("dispatch-surface-dispatched"),
      args: [input],
      workflowExecutionTimeout: "30s",
    });

    expect(ran).toContain("HydrateWorkflowExecution");
  }, 60_000);
});

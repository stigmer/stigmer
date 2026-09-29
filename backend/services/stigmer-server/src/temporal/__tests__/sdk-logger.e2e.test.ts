/**
 * The Temporal SDK's lines reach the server logger's sink through the real
 * Runtime (#1037), end to end: the process bridge installed over the real
 * `Runtime.install`, a real TemporalManager building its worker through
 * createWorker, and a local Temporal server. It pins:
 *
 *   - `Activity failed` arrives at warn with the activity's identity
 *     (activityType, workflowId, workflowType, attempt) and the error as
 *     its message, and without the activity's taskToken;
 *   - a workflow body's `log.warn` arrives with every field it passed,
 *     the nested one included, tagged `sdkComponent: workflow`;
 *   - the SDK's debug `Creating worker` line arrives without the worker
 *     options it carries (the payload codecs and their keys ride there).
 *
 * Its own file, so its own vitest process: the Runtime is a process
 * singleton, and this file installs the real one. The bridge attaches
 * BEFORE TestWorkflowEnvironment.createLocal, which creates the Runtime
 * itself; the manager's own attach then retargets the same bridge. Like
 * the invoke-workflow suites, every test is VISIBLY skipped when the
 * local Temporal server cannot start (no `temporal` CLI), never a vacuous
 * green.
 */
import { ApplicationFailure } from "@temporalio/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLogger, type LogEntry } from "../../boot/logger.js";
import { TemporalManager } from "../manager.js";
import { processSdkLogBridge } from "../sdk-logger.js";
import {
  SDK_LOG_PROBE_ACTIVITY,
  SDK_LOG_PROBE_WARNING,
  SDK_LOG_PROBE_WORKFLOW,
} from "./sdk-log-workflows.js";

const TASK_QUEUE = "sdk-logger-e2e";
const WORKFLOWS_PATH = new URL("./sdk-log-workflows.ts", import.meta.url)
  .pathname;

type TestWorkflowEnvironment =
  import("@temporalio/testing").TestWorkflowEnvironment;

const entries: LogEntry[] = [];
const logger = createLogger({
  level: "debug",
  pretty: false,
  write: () => {},
  sink: (entry) => entries.push(entry),
});

let env: TestWorkflowEnvironment | null = null;
let manager: TemporalManager | null = null;
let envReady = false;

function findEntry(
  level: LogEntry["level"],
  message: string,
): LogEntry | undefined {
  return entries.find(
    (entry) => entry.level === level && entry.message === message,
  );
}

describe("Temporal SDK lines through the server logger (real Runtime)", () => {
  beforeAll(async () => {
    processSdkLogBridge.attach(logger);
    try {
      const { TestWorkflowEnvironment: TWE } =
        await import("@temporalio/testing");
      env = await TWE.createLocal();
    } catch (error) {
      console.warn(
        `Temporal test server unavailable (tests will be skipped): ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    manager = new TemporalManager({
      hostPort: env.address,
      namespace: env.namespace ?? "default",
      connection: {},
      logger,
      payloadCodecs: [],
      workerFactories: [
        (deps) =>
          deps.createWorker({
            taskQueue: TASK_QUEUE,
            activities: {
              [SDK_LOG_PROBE_ACTIVITY]: async () => {
                throw ApplicationFailure.create({
                  message: "probe activity exploded",
                  type: "SdkLogProbeFailure",
                });
              },
            },
            workflows: { workflowsPath: WORKFLOWS_PATH },
          }),
      ],
    });
    envReady =
      (await manager.initialConnect()) &&
      (await manager.startWorkers().then(() => true));
  }, 120_000);

  afterAll(async () => {
    await manager?.close();
    if (env) await env.teardown();
  }, 30_000);

  it("carries Activity failed, a workflow warning and the worker's creation line", async (testCtx) => {
    if (!envReady || env === null) return testCtx.skip();

    const workflowId = `sdk-logger-e2e-${Date.now()}`;
    await expect(
      env.client.workflow.execute(SDK_LOG_PROBE_WORKFLOW, {
        taskQueue: TASK_QUEUE,
        workflowId,
      }),
    ).rejects.toThrow();

    const failed = findEntry("warn", "Activity failed");
    expect(failed, "the activity failure must reach the sink").toBeDefined();
    expect(failed?.fields).toMatchObject({
      sdkComponent: "worker",
      activityType: SDK_LOG_PROBE_ACTIVITY,
      workflowId,
      workflowType: SDK_LOG_PROBE_WORKFLOW,
      attempt: 1,
      error: "probe activity exploded",
    });
    expect(failed?.fields).not.toHaveProperty("taskToken");

    const warning = findEntry("warn", SDK_LOG_PROBE_WARNING);
    expect(warning, "the workflow's warning must reach the sink").toBeDefined();
    expect(warning?.fields).toMatchObject({
      sdkComponent: "workflow",
      workflowId,
      workflowType: SDK_LOG_PROBE_WORKFLOW,
      probeCount: 3,
      outcomes: { reaped: 2, kept: 1 },
    });

    const creating = findEntry("debug", "Creating worker");
    expect(creating, "the SDK's debug lines must reach the sink").toBeDefined();
    expect(creating?.fields).toMatchObject({
      sdkComponent: "worker",
      taskQueue: TASK_QUEUE,
    });
    expect(creating?.fields).not.toHaveProperty("options");
  }, 60_000);
});

/**
 * The Temporal manager's boot schedule against the real SDK and a real
 * local Temporal server (#2178), the end-to-end half of manager.test.ts's
 * stubbed cases. It pins:
 *
 *   - initialConnect() against a closed port returns false after ONE real
 *     dial window (the SDK re-dials a refused port inside its ~1s connect
 *     window), not the old three-attempt schedule's ~6s, which every boot
 *     of a composed test against a closed port used to spend;
 *   - a Temporal that starts after that failed boot is connected in the
 *     background by the monitor: the reconnect path builds the real worker,
 *     which then runs a workflow to completion, and each reconnect hook
 *     fires exactly once.
 *
 * Its own file, so its own vitest process: the SDK Runtime is a process
 * singleton. The second case is VISIBLY skipped when the local Temporal
 * server cannot start (no `temporal` CLI), never a vacuous green.
 */
import { createServer } from "node:net";

import { afterAll, describe, expect, it } from "vitest";

import { createLogger } from "../../boot/logger.js";
import { TemporalManager } from "../manager.js";
import {
  SDK_LOG_PROBE_ACTIVITY,
  SDK_LOG_PROBE_WORKFLOW,
} from "./sdk-log-workflows.js";

const TASK_QUEUE = "manager-boot-e2e";
const WORKFLOWS_PATH = new URL("./sdk-log-workflows.ts", import.meta.url)
  .pathname;

/**
 * One real dial window plus margin for a loaded runner. The old schedule
 * spent three windows and 3s of sleep (~6s), so the bound fails it.
 */
const ONE_DIAL_BOUND_MS = 3_000;

/**
 * The monitor's first tick (15s) is the latest the late connect can land
 * when the server comes up after both background attempts; the margin is
 * for the worker's workflow bundling.
 */
const LATE_CONNECT_DEADLINE_MS = 40_000;

type TestWorkflowEnvironment =
  import("@temporalio/testing").TestWorkflowEnvironment;

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

/** A port nothing listens on now: bound by the OS, then released. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(
  predicate: () => boolean,
  deadlineMs: number,
): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return predicate();
}

const port = await freePort();
let hooks = 0;
let activityRuns = 0;
const manager = new TemporalManager({
  hostPort: `127.0.0.1:${port}`,
  namespace: "default",
  connection: {},
  logger: silentLogger,
  payloadCodecs: [],
  workerFactories: [
    (deps) =>
      deps.createWorker({
        taskQueue: TASK_QUEUE,
        activities: {
          [SDK_LOG_PROBE_ACTIVITY]: async () => {
            activityRuns++;
          },
        },
        workflows: { workflowsPath: WORKFLOWS_PATH },
      }),
  ],
});
manager.addReconnectHook(() => {
  hooks++;
});
let env: TestWorkflowEnvironment | null = null;

afterAll(async () => {
  await manager.close();
  if (env) await env.teardown();
}, 30_000);

describe("TemporalManager boot schedule (real SDK, #2178)", () => {
  it("returns from initialConnect after one dial window when no Temporal listens", async () => {
    const started = Date.now();
    const connected = await manager.initialConnect();
    const elapsedMs = Date.now() - started;

    expect(connected).toBe(false);
    expect(
      elapsedMs,
      `boot spent ${elapsedMs}ms on an absent engine; one dial window is the budget`,
    ).toBeLessThan(ONE_DIAL_BOUND_MS);
    expect(manager.getClient()).toBeUndefined();
  });

  it(
    "connects a Temporal that starts after boot in the background, with a polling worker and one hook",
    async (testCtx) => {
      manager.startHealthMonitor();
      try {
        const { TestWorkflowEnvironment: TWE } =
          await import("@temporalio/testing");
        env = await TWE.createLocal({ server: { port } });
      } catch (error) {
        console.warn(
          `Temporal test server unavailable (test skipped): ${error instanceof Error ? error.message : String(error)}`,
        );
        return testCtx.skip();
      }

      const connected = await waitFor(
        () => manager.isConnected(),
        LATE_CONNECT_DEADLINE_MS,
      );
      expect(connected, "the monitor connects the late engine").toBe(true);
      expect(manager.getClient()).toBeDefined();

      await env.client.workflow.execute(SDK_LOG_PROBE_WORKFLOW, {
        taskQueue: TASK_QUEUE,
        workflowId: `manager-boot-e2e-${Date.now()}`,
        workflowExecutionTimeout: "30 seconds",
      });
      expect(activityRuns, "the late-built worker ran the activity").toBe(1);
      expect(hooks, "each reconnect hook fires once on the late connect").toBe(1);
    },
    90_000,
  );
});

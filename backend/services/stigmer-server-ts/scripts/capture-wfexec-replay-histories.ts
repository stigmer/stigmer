/**
 * Captures workflow-execution orchestrator histories for the replay
 * determinism gate — the twin of capture-replay-histories.ts (see its
 * header for the discipline and the proto-JSON round-trip rationale).
 *
 * Runs the core orchestration scenarios against a local Temporal test
 * server with the scriptable stub child (test-workflows.ts) and no-op
 * recorder activities (mock data only — safe to commit), writing each
 * history's proto-JSON to
 * src/temporal/workflowexecution/__tests__/replay-histories/.
 *
 * Usage: npx tsx scripts/capture-wfexec-replay-histories.ts
 * (requires the `temporal` CLI on PATH — same as the workflow tests)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import proto from "@temporalio/proto";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";

const TASK_QUEUE = "wfexec-replay-capture";
const WORKFLOWS_PATH = fileURLToPath(
  new URL(
    "../src/temporal/workflowexecution/__tests__/test-workflows.ts",
    import.meta.url,
  ),
);
const OUT_DIR = fileURLToPath(
  new URL(
    "../src/temporal/workflowexecution/__tests__/replay-histories",
    import.meta.url,
  ),
);

const childEvents: string[] = [];

const activities = {
  UpdateWorkflowExecutionStatus: async () => {},
  DeleteExecutionContext: async () => {},
  TestRecordChildEvent: async (event: string) => {
    childEvents.push(event);
  },
};

async function waitForChildEvent(event: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (childEvents.includes(event)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`capture timed out waiting for child event ${event}`);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const env = await TestWorkflowEnvironment.createLocal();
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: WORKFLOWS_PATH,
    activities,
  });
  const runPromise = worker.run();

  async function capture(
    name: string,
    executionId: string,
    drive: (
      handle: import("@temporalio/client").WorkflowHandle,
    ) => Promise<void>,
  ): Promise<void> {
    childEvents.length = 0;
    const handle = await env.client.workflow.start(
      "stigmer/workflow-execution/invoke",
      {
        taskQueue: TASK_QUEUE,
        workflowId: `wfexec-replay-${name}`,
        args: [
          {
            execution_id: executionId,
            workflow_instance_id: "wfi-replay",
            workflow_id: "wf-replay",
            org_id: "org-replay",
          },
        ],
        memo: { runnerTaskQueue: TASK_QUEUE },
      },
    );
    await drive(handle);
    const history = await handle.fetchHistory();
    const json = proto.temporal.api.history.v1.History.fromObject(
      history,
    ).toJSON();
    writeFileSync(
      `${OUT_DIR}/${name}.json`,
      JSON.stringify(json, null, 2) + "\n",
    );
    console.log(`captured ${name}.json`);
  }

  // 1. Happy path: child completes → EC cleanup, no persists.
  await capture("happy-completed", "wfe-ok", async (handle) => {
    await handle.result();
  });

  // 2. Pause/resume: serialized PAUSED/IN_PROGRESS persists + relays,
  //    release THROUGH the relay lane (the orchestrator has no
  //    test-release handler of its own — the envelope is how any
  //    task-specific signal reaches the child), completion.
  await capture("pause-resume", "wfe-hold-pr", async (handle) => {
    await waitForChildEvent("started");
    await handle.signal("pause", "replay capture");
    await waitForChildEvent("pause:replay capture");
    await handle.signal("resume");
    await waitForChildEvent("resume");
    await handle.signal("relaySignal", {
      signalName: "test-release",
      payload: null,
    });
    await handle.result();
  });

  // 3. Failure path: FAILED persist + EC cleanup + ApplicationFailure.
  await capture("child-failed", "wfe-fail", async (handle) => {
    await handle.result().catch(() => {});
  });

  worker.shutdown();
  await runPromise.catch(() => {});
  await env.teardown();
}

await main();
process.exit(0);

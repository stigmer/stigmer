/**
 * Captures schedule/tick workflow histories for the replay determinism
 * gate — the go-forward discipline: any change to the tick's logic must
 * replay committed histories green, or be gated with patched().
 * Histories are REGENERATED only when no producing release is still
 * supported.
 *
 * Three scenarios (tick-completed-run, tick-skipped-disabled,
 * tick-start-failed). Mock data only — safe to commit. Writes proto-JSON to
 * src/temporal/routine/__tests__/replay-histories/.
 *
 * Usage: npx tsx scripts/capture-routine-replay-histories.ts
 * (requires the `temporal` CLI on PATH — same as the workflow tests)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import proto from "@temporalio/proto";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";

const TASK_QUEUE = "schedule-replay-capture";
const CAPTURE_IDENTITY = "replay-capture";
const WORKFLOWS_PATH = fileURLToPath(
  new URL("../src/temporal/routine/workflows/index.ts", import.meta.url),
);
const OUT_DIR = fileURLToPath(
  new URL("../src/temporal/routine/__tests__/replay-histories", import.meta.url),
);

// Scenario scripting mirrors the tick workflow tests' double.
let tickOutcome = "FIRED";
let runStart: Record<string, unknown> = {};
let pollResult = "COMPLETED";

const activities = {
  "stigmer/schedule/record-tick": async () => tickOutcome,
  "stigmer/schedule/start-run": async () => runStart,
  "stigmer/schedule/poll-phase": async () => pollResult,
  "stigmer/schedule/record-success": async () => {},
  "stigmer/schedule/record-failure": async () => ({
    consecutiveFailures: 1,
    paused: false,
  }),
};

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  // One fixed identity for the client and the worker, so a committed
  // history names no machine.
  const env = await TestWorkflowEnvironment.createLocal({ client: { identity: CAPTURE_IDENTITY } });
  const worker = await Worker.create({
    identity: CAPTURE_IDENTITY,
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: WORKFLOWS_PATH,
    activities,
  });
  const runPromise = worker.run();

  async function capture(name: string): Promise<void> {
    // The artifact's workflow-id shape with an RFC-3339 fire suffix — the
    // tick's tier-2 nominal derivation, exactly what a real fire replays:
    // workflowId = artifactId(scheduleId) + "-" + fireTime, so the
    // scenario name rides the SCHEDULE id and the suffix stays a pure
    // timestamp the tier-2 parser accepts.
    const scheduleId = `rtn_replay_${name.replaceAll("-", "_")}`;
    const handle = await env.client.workflow.start("schedule/tick", {
      taskQueue: TASK_QUEUE,
      workflowId: `schedule/tick/${scheduleId}-2026-08-25T09:30:00Z`,
      args: [scheduleId],
    });
    await handle.result();
    const history = await handle.fetchHistory();
    // protobufjs' OWN toJSON/fromObject round-trip — see
    // capture-replay-histories.ts for why not the SDK's historyToJSON.
    const json = proto.temporal.api.history.v1.History.fromObject(history).toJSON();
    writeFileSync(`${OUT_DIR}/${name}.json`, JSON.stringify(json, null, 2) + "\n");
    console.log(`captured ${name}.json`);
  }

  // 1. The tracked happy path: FIRED → STARTED → poll COMPLETED → the
  //    success reset.
  tickOutcome = "FIRED";
  runStart = {
    outcome: "STARTED",
    executionId: "run_replay",
    trackingTimeoutMinutes: 60,
    failureReason: "",
  };
  pollResult = "COMPLETED";
  await capture("tick-completed-run");

  // 2. The revalidation decline.
  tickOutcome = "SKIPPED_DISABLED";
  await capture("tick-skipped-disabled");

  // 3. The start failure: FIRED → TARGET_MISSING → the single-attempt
  //    failure record.
  tickOutcome = "FIRED";
  runStart = {
    outcome: "TARGET_MISSING",
    executionId: "",
    trackingTimeoutMinutes: 60,
    failureReason: "target agent acme/gone not found",
  };
  await capture("tick-start-failed");

  worker.shutdown();
  await runPromise.catch(() => {});
  await env.teardown();
}

await main();
process.exit(0);

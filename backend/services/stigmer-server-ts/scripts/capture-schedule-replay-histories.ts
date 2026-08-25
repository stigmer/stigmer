/**
 * Captures schedule/tick workflow histories for the replay determinism
 * gate — the OD-6 go-forward discipline the schedule domain itself
 * originated (Go tick_history_capture_test.go): any change to the tick's
 * logic must replay committed histories green, or be gated with patched().
 * Histories are REGENERATED only when no producing release is still
 * supported.
 *
 * The three scenarios mirror Go's gold masters name-for-name
 * (tick-completed-run, tick-skipped-disabled, tick-start-failed) —
 * captured fresh here because Go histories cannot replay against the TS
 * SDK. Mock data only — safe to commit. Writes proto-JSON to
 * src/temporal/schedule/__tests__/replay-histories/.
 *
 * Usage: npx tsx scripts/capture-schedule-replay-histories.ts
 * (requires the `temporal` CLI on PATH — same as the workflow tests)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import proto from "@temporalio/proto";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";

const TASK_QUEUE = "schedule-replay-capture";
const WORKFLOWS_PATH = fileURLToPath(
  new URL("../src/temporal/schedule/workflows/index.ts", import.meta.url),
);
const OUT_DIR = fileURLToPath(
  new URL("../src/temporal/schedule/__tests__/replay-histories", import.meta.url),
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
  const env = await TestWorkflowEnvironment.createLocal();
  const worker = await Worker.create({
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
    const scheduleId = `sch-replay-${name}`;
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
  //    success reset (Go tick-completed-run.json).
  tickOutcome = "FIRED";
  runStart = {
    outcome: "STARTED",
    executionId: "aex-replay",
    trackingTimeoutMinutes: 60,
    failureReason: "",
  };
  pollResult = "COMPLETED";
  await capture("tick-completed-run");

  // 2. The revalidation decline (Go tick-skipped-disabled.json).
  tickOutcome = "SKIPPED_DISABLED";
  await capture("tick-skipped-disabled");

  // 3. The start failure: FIRED → TARGET_MISSING → the single-attempt
  //    failure record (Go tick-start-failed.json).
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

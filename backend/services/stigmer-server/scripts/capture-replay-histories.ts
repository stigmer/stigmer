/**
 * Captures Temporal workflow histories for the replay determinism gate —
 * the go-forward discipline: any change to a running
 * workflow's logic must replay committed histories green, or be gated
 * with patched(). Histories are REGENERATED only when no producing
 * release is still supported.
 *
 * Runs the core agent-execution scenarios against a local Temporal test
 * server with scripted activities (mock data only — safe to commit) and
 * writes each history's proto-JSON to
 * src/temporal/agentexecution/__tests__/replay-histories/.
 *
 * Every activity the workflow schedules is scripted here, so a history
 * records no activity failure the scenario did not script.
 *
 * Usage: npx tsx scripts/capture-replay-histories.ts [--force]
 * (requires the `temporal` CLI on PATH — same as the workflow tests)
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import proto from "@temporalio/proto";
import { ApplicationFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";

const TASK_QUEUE = "replay-capture";
const CAPTURE_IDENTITY = "replay-capture";
const WORKFLOWS_PATH = fileURLToPath(
  new URL("../src/temporal/agentexecution/workflows/index.ts", import.meta.url),
);
const OUT_DIR = fileURLToPath(
  new URL(
    "../src/temporal/agentexecution/__tests__/replay-histories",
    import.meta.url,
  ),
);

// Scenario scripting mirrors the workflow unit tests' double: behaviors
// consumed per agent invocation, open-gate counts per HITL read.
let executeBehaviors: Array<() => Promise<Record<string, unknown>>> = [];
let gateCounts: number[] = [];
// The sandbox ensure's answers, one per ask; "ready" once used up.
let sandboxAnswers: string[] = [];

const activities = {
  EnsureThread: async () => "thread-1",
  GenerateSessionSubject: async () => {},
  ExecuteDeepAgent: async () => {
    const behavior = executeBehaviors.shift();
    if (!behavior) throw new Error("capture script exhausted");
    return behavior();
  },
  // The Claude engine shares the Stigmer harness's deterministic-state flow
  // and its scripted turns.
  ExecuteClaude: async () => {
    const behavior = executeBehaviors.shift();
    if (!behavior) throw new Error("capture script exhausted");
    return behavior();
  },
  UpdateExecutionStatus: async () => {},
  // The HITL wait counts the turn's open gates in its session's log.
  CountOpenGates: async () => (gateCounts.length > 1 ? gateCounts.shift()! : (gateCounts[0] ?? 0)),
  CloseFileReview: async () => {},
  // The session's queued turn, started as the workflow ends.
  StartQueuedTurn: async () => {},
  // The turn's sandbox, asked for on a CLOUD target before the runner.
  EnsureSessionSandbox: async () => sandboxAnswers.shift() ?? "ready",
};

/** The run every scenario dispatches, under the kinds' id prefixes. */
const RUN_INPUT = { execution_id: "run_replay", session_id: "ses_replay", agent_id: "agt_replay" };

/**
 * The history with every failure's stack trace emptied. A stack trace
 * names the files of the checkout that captured it, and a replay reads
 * none (the workflow sees a failure's type and message), so a committed
 * history carries no machine's paths.
 */
function withoutStackTraces(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutStackTraces);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [
        key,
        key === "stackTrace" ? "" : withoutStackTraces(field),
      ]),
    );
  }
  return value;
}

function slim(phase: string): Record<string, unknown> {
  return { phase };
}

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

  async function capture(
    name: string,
    input: Record<string, unknown>,
    drive: (handle: import("@temporalio/client").WorkflowHandle) => Promise<void>,
  ): Promise<void> {
    // Committed histories are the replay gate's CONTRACT (replay.test.ts):
    // regenerating one from current code silently hollows the gate out, so
    // existing files are never overwritten. Adding a NEW scenario just works;
    // deliberate regeneration (only when no producing release is still
    // supported) is --force.
    if (existsSync(`${OUT_DIR}/${name}.json`) && !process.argv.includes("--force")) {
      console.log(`skipped ${name}.json (committed history — --force to regenerate)`);
      return;
    }
    const handle = await env.client.workflow.start(
      "stigmer/agent-execution/invoke",
      {
        taskQueue: TASK_QUEUE,
        workflowId: `replay-${name}`,
        args: [input],
        memo: { activityTaskQueue: TASK_QUEUE },
      },
    );
    await drive(handle);
    const history = await handle.fetchHistory();
    // protobufjs' OWN toJSON/fromObject round-trip (longs and enums as
    // strings, bytes as base64) — deliberately NOT the SDK's
    // historyToJSON/historyFromJSON pair: those route through
    // proto3-json-serializer, whose pinned v2.0.2 throws on payload
    // buffers before the SDK's fixBuffers workaround can run (the SDK's
    // own doc cites googleapis/proto3-json-serializer-nodejs#103). The
    // replay test loads with History.fromObject, the exact inverse.
    const json = withoutStackTraces(
      proto.temporal.api.history.v1.History.fromObject(history).toJSON(),
    );
    writeFileSync(
      `${OUT_DIR}/${name}.json`,
      JSON.stringify(json, null, 2) + "\n",
    );
    console.log(`captured ${name}.json`);
  }

  // 1. Happy path: EnsureThread → one completed turn.
  executeBehaviors = [async () => slim("RUN_COMPLETED")];
  gateCounts = [];
  await capture(
    "happy-completed",
    RUN_INPUT,
    async (handle) => {
      await handle.result();
    },
  );

  // 2. HITL cycle: WAITING → gate re-read → approvalGateResolved →
  //    re-invoke (TurnSeq 1) → completed.
  executeBehaviors = [
    async () => slim("RUN_WAITING_FOR_APPROVAL"),
    async () => slim("RUN_COMPLETED"),
  ];
  gateCounts = [1];
  await capture(
    "hitl-approval",
    RUN_INPUT,
    async (handle) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await handle.signal("approvalGateResolved");
      await handle.result();
    },
  );

  // 3. Pause/resume: cancelable-scope pause, PAUSED persist, resume with
  //    the healing IN_PROGRESS persist (oss#869), re-invoke, completed.
  let releaseHold: (() => void) | undefined;
  executeBehaviors = [
    () =>
      new Promise<Record<string, unknown>>((resolve) => {
        releaseHold = () => resolve(slim("RUN_COMPLETED"));
      }),
    async () => slim("RUN_COMPLETED"),
  ];
  gateCounts = [];
  await capture(
    "pause-resume",
    RUN_INPUT,
    async (handle) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await handle.signal("pause", "replay capture");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await handle.signal("resume");
      await handle.result();
      releaseHold?.();
    },
  );

  // 4. Runner-reported failure: the turn RETURNS a FAILED slim result,
  //    so the workflow persists the phase-only FAILED fallback, throws,
  //    and runs the failure-path status write. Pins the command shape of
  //    that path.
  executeBehaviors = [
    async () => ({ phase: "RUN_FAILED", error: "replay capture failure" }),
  ];
  gateCounts = [];
  await capture(
    "runner-failed",
    RUN_INPUT,
    async (handle) => {
      await handle.result().catch(() => {});
    },
  );

  // 5. User cancel while the turn runs: the workflow's cancellation
  //    cleanup (the CANCELLED status write) on a non-cancellable scope, without waiting for the
  //    runner activity to acknowledge (the proxy's default TRY_CANCEL).
  //    The held turn is released afterwards so worker shutdown, which
  //    waits for in-flight activities, can complete.
  let releaseCancelHold: (() => void) | undefined;
  executeBehaviors = [
    () =>
      new Promise<Record<string, unknown>>((resolve) => {
        releaseCancelHold = () => resolve(slim("RUN_CANCELLED"));
      }),
  ];
  gateCounts = [];
  await capture(
    "user-cancel",
    RUN_INPUT,
    async (handle) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await handle.cancel();
      await handle.result().catch(() => {});
    },
  );
  releaseCancelHold?.();

  // 6. A drained turn recovered: the runner's worker stops the turn past
  //    its drain grace (Temporal's core reports it as its own WorkerShutdown
  //    failure), the workflow persists IN_PROGRESS, backs off and re-invokes,
  //    and the turn completes.
  executeBehaviors = [
    async () => {
      throw ApplicationFailure.create({
        type: "WorkerShutdown",
        message: "Worker is shutting down and this activity did not complete in time",
      });
    },
    async () => slim("RUN_COMPLETED"),
  ];
  gateCounts = [];
  await capture(
    "drain-recovered",
    RUN_INPUT,
    async (handle) => {
      await handle.result();
    },
  );

  // 7. A drained turn that yielded and continued: the runner's engine
  //    stopped at a step boundary and threw the typed continuation
  //    (StigmerTurnContinues, cause drain), which the workflow recovers;
  //    the next turn completes.
  executeBehaviors = [
    async () => {
      throw ApplicationFailure.create({
        type: "StigmerTurnContinues",
        message: "The turn continues on the next invocation",
        details: ["drain"],
      });
    },
    async () => slim("RUN_COMPLETED"),
  ];
  gateCounts = [];
  await capture(
    "drain-continued",
    RUN_INPUT,
    async (handle) => {
      await handle.result();
    },
  );

  // 8. A Claude turn's HITL cycle: the deterministic-state flow with the
  //    Claude engine's activity — EnsureThread, ExecuteClaude WAITING, gate
  //    re-read, approvalGateResolved, ExecuteClaude (TurnSeq 1) completed.
  executeBehaviors = [
    async () => slim("RUN_WAITING_FOR_APPROVAL"),
    async () => slim("RUN_COMPLETED"),
  ];
  gateCounts = [1];
  await capture(
    "claude-hitl-approval",
    { ...RUN_INPUT, harness: 3 },
    async (handle) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await handle.signal("approvalGateResolved");
      await handle.result();
    },
  );

  // 9. A turn that waited for a sandbox with room: on a CLOUD target the
  //    workflow asks for the sandbox (the patch marker), hears "no room",
  //    writes the run waiting, sleeps one backoff and asks again; room
  //    comes, and the turn runs and completes.
  executeBehaviors = [async () => slim("RUN_COMPLETED")];
  gateCounts = [];
  sandboxAnswers = ["no_room"];
  await capture(
    "sandbox-waited",
    { ...RUN_INPUT, execution_target: 2, caller_class: "user", sandbox_wait_seconds: 900 },
    async (handle) => {
      await handle.result();
    },
  );

  // 10. A CLOUD turn's HITL cycle past the re-ask (stigmer#3122):
  //     the first ask, WAITING, gate re-read, approvalGateResolved, then
  //     IN_PROGRESS written, the sandbox asked for again (the second patch
  //     marker) with no room once, waiting, room, IN_PROGRESS again, and
  //     the re-invocation (TurnSeq 1) completes. The cloud-hitl-approval
  //     history is the same turn recorded before the re-ask existed.
  const CLOUD_INPUT = { ...RUN_INPUT, execution_target: 2, caller_class: "user", sandbox_wait_seconds: 900 };
  executeBehaviors = [
    async () => slim("RUN_WAITING_FOR_APPROVAL"),
    async () => slim("RUN_COMPLETED"),
  ];
  gateCounts = [1];
  sandboxAnswers = ["ready", "no_room"];
  await capture(
    "hitl-approval-reensured",
    CLOUD_INPUT,
    async (handle) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await handle.signal("approvalGateResolved");
      await handle.result();
    },
  );

  // 11. A CLOUD turn paused and resumed past the re-ask: the resume's
  //     IN_PROGRESS, then the sandbox asked for again before the next
  //     attempt, which completes. The cloud-pause-resume history is the
  //     same turn recorded before the re-ask existed.
  let releaseCloudHold: (() => void) | undefined;
  executeBehaviors = [
    () =>
      new Promise<Record<string, unknown>>((resolve) => {
        releaseCloudHold = () => resolve(slim("RUN_COMPLETED"));
      }),
    async () => slim("RUN_COMPLETED"),
  ];
  gateCounts = [];
  sandboxAnswers = [];
  await capture(
    "pause-resume-reensured",
    CLOUD_INPUT,
    async (handle) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await handle.signal("pause", "replay capture");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await handle.signal("resume");
      await handle.result();
      releaseCloudHold?.();
    },
  );

  worker.shutdown();
  await runPromise.catch(() => {});
  await env.teardown();
}

await main();
process.exit(0);

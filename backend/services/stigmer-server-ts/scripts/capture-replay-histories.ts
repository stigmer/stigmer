/**
 * Captures Temporal workflow histories for the replay determinism gate —
 * the OD-6 go-forward discipline (D2 §4): any change to a running
 * workflow's logic must replay committed histories green, or be gated
 * with patched(). Histories are REGENERATED only when no producing
 * release is still supported (the schedule domain's Go rule, adopted
 * here).
 *
 * Runs the core agent-execution scenarios against a local Temporal test
 * server with scripted activities (mock data only — safe to commit) and
 * writes each history's proto-JSON to
 * src/temporal/agentexecution/__tests__/replay-histories/.
 *
 * Usage: npx tsx scripts/capture-replay-histories.ts
 * (requires the `temporal` CLI on PATH — same as the workflow tests)
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import proto from "@temporalio/proto";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";

const TASK_QUEUE = "replay-capture";
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
// consumed per agent invocation, gate states per load.
let executeBehaviors: Array<() => Promise<Record<string, unknown>>> = [];
let loadResults: Array<Record<string, unknown>> = [];

const activities = {
  EnsureThread: async () => "thread-1",
  GenerateSessionSubject: async () => {},
  ExecuteDeepAgent: async () => {
    const behavior = executeBehaviors.shift();
    if (!behavior) throw new Error("capture script exhausted");
    return behavior();
  },
  ExecuteCursor: async () => {
    throw new Error("not used in capture scenarios");
  },
  UpdateExecutionStatus: async () => {},
  LoadAgentExecution: async () =>
    loadResults.length > 1 ? loadResults.shift()! : loadResults[0]!,
  ReadHarnessStateId: async () => "",
  DeleteExecutionContext: async () => {},
  "stigmer/system/complete-external-activity": async () => {},
};

function slim(phase: string): Record<string, unknown> {
  return { phase };
}

function executionWithPendingApproval(): Record<string, unknown> {
  return {
    metadata: { id: "exec-replay" },
    status: {
      phase: "EXECUTION_WAITING_FOR_APPROVAL",
      pendingApprovals: [{ toolCallId: "tc-1", toolName: "echo" }],
    },
  };
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
    const json = proto.temporal.api.history.v1.History.fromObject(
      history,
    ).toJSON();
    writeFileSync(
      `${OUT_DIR}/${name}.json`,
      JSON.stringify(json, null, 2) + "\n",
    );
    console.log(`captured ${name}.json`);
  }

  // 1. Happy path: EnsureThread → one completed turn → EC cleanup.
  executeBehaviors = [async () => slim("EXECUTION_COMPLETED")];
  loadResults = [];
  await capture(
    "happy-completed",
    { execution_id: "exec-replay", session_id: "ses-1", agent_id: "agt-1" },
    async (handle) => {
      await handle.result();
    },
  );

  // 2. HITL cycle: WAITING → gate re-read → approvalGateResolved →
  //    re-invoke (TurnSeq 1) → completed.
  executeBehaviors = [
    async () => slim("EXECUTION_WAITING_FOR_APPROVAL"),
    async () => slim("EXECUTION_COMPLETED"),
  ];
  loadResults = [executionWithPendingApproval()];
  await capture(
    "hitl-approval",
    { execution_id: "exec-replay", session_id: "ses-1", agent_id: "agt-1" },
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
        releaseHold = () => resolve(slim("EXECUTION_COMPLETED"));
      }),
    async () => slim("EXECUTION_COMPLETED"),
  ];
  loadResults = [];
  await capture(
    "pause-resume",
    { execution_id: "exec-replay", session_id: "ses-1", agent_id: "agt-1" },
    async (handle) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await handle.signal("pause", "replay capture");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await handle.signal("resume");
      await handle.result();
      releaseHold?.();
    },
  );

  // 4. Parented HITL cycle (D4 #23): same gate as scenario 2 but with a
  //    parent_workflow_id, so the history carries the two parent
  //    notifications (child_execution_started at start,
  //    child_approval_required from the HITL loop) — the DD-012 sender
  //    pinned in the replay gate. The parent id is deliberately
  //    nonexistent: the sends fail non-fatally, which is itself part of
  //    the recorded command shape.
  executeBehaviors = [
    async () => slim("EXECUTION_WAITING_FOR_APPROVAL"),
    async () => slim("EXECUTION_COMPLETED"),
  ];
  loadResults = [executionWithPendingApproval()];
  await capture(
    "hitl-approval-parented",
    {
      execution_id: "exec-replay",
      session_id: "ses-1",
      agent_id: "agt-1",
      parent_workflow_id: "replay-parent-probe",
    },
    async (handle) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await handle.signal("approvalGateResolved");
      await handle.result();
    },
  );

  worker.shutdown();
  await runPromise.catch(() => {});
  await env.teardown();
}

await main();
process.exit(0);

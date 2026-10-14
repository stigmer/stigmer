/**
 * Captures eval suite workflow histories for the evals' replay determinism
 * gate (src/temporal/evals/__tests__/replay.test.ts): a suite lives for
 * hours to days, so one in flight WILL straddle a release, and every
 * change to the suite or case workflow must replay the committed
 * histories green, or be gated with patched().
 *
 * Two scenarios, each two tries of one case with one AI-graded check, so
 * the history holds child workflows under their ids, votes and records:
 *
 *   - plugin-eval-completed: a plugin eval whose load answers a plan with
 *     no `caseWorkflowPrefix`, the plan's shape before agent evals; its
 *     committed history was captured on the code before that field
 *     existed (`--workflows` pointed at that checkout's workflow barrel);
 *   - agent-eval-completed: an agent eval under its own type, whose plan
 *     names the `agent-eval` prefix.
 *
 * Mock data only, safe to commit. Writes proto-JSON to
 * src/temporal/evals/__tests__/replay-histories/. Regenerate a history only
 * when no producing release is still supported.
 *
 * Usage: npx tsx scripts/capture-eval-replay-histories.ts [--only plugin|agent] [--workflows <path to workflows/index.ts>]
 * (requires the `temporal` CLI on PATH, as the workflow tests do)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import proto from "@temporalio/proto";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";

const TASK_QUEUE = "eval-replay-capture";
const OUT_DIR = fileURLToPath(new URL("../src/temporal/evals/__tests__/replay-histories", import.meta.url));

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const WORKFLOWS_PATH =
  argument("--workflows") ?? fileURLToPath(new URL("../src/temporal/evals/workflows/index.ts", import.meta.url));
const ONLY = argument("--only");

/** The plan the load answers: two tries of case 0, optionally naming the prefix. */
let plan: Record<string, unknown> = {};

const activities = {
  "stigmer/evals/load-suite": async () => plan,
  "stigmer/evals/record-try": async () => {},
  "stigmer/evals/finish-eval": async () => {},
  "stigmer/evals/try-spend": async () => ({ sessionId: "", runId: "", costUsd: 0 }),
  "stigmer/evals/start-try": async (input: { tryIndex: number }) => ({
    kind: "started",
    sessionId: `ses_${input.tryIndex}`,
    runId: `run_${input.tryIndex}`,
  }),
  "stigmer/evals/poll-run": async () => ({ phase: "ended", startedAtMs: 0 }),
  "stigmer/evals/stop-run": async () => {},
  "stigmer/evals/grade-try": async () => ({
    outcomes: [{ votes: "criteria" }, { passed: true, reason: "found" }],
    error: "",
    costUsd: 0.1,
    durationSeconds: 1,
  }),
  "stigmer/evals/start-vote": async (_input: unknown, runId: string, graderIndex: number, voteIndex: number) => ({
    kind: "started",
    voteRunId: `${runId}_vote_${graderIndex}_${voteIndex}`,
  }),
  "stigmer/evals/read-vote": async () => ({ vote: { kind: "vote", passed: true, reason: "yes" }, costUsd: 0.01 }),
  "stigmer/evals/delete-vote": async () => {},
  "stigmer/evals/record-score": async (
    _input: unknown,
    started: { sessionId: string; runId: string },
    grade: { error: string; costUsd: number; durationSeconds: number },
  ) => ({
    sessionId: started.sessionId,
    runId: started.runId,
    state: "graded",
    score: 1,
    notGradedReason: "",
    error: grade.error,
    costUsd: grade.costUsd,
    durationSeconds: grade.durationSeconds,
  }),
};

const CELLS = [0, 1].map((tryIndex) => ({
  caseIndex: 0,
  targetIndex: 0,
  arm: "with",
  tryIndex,
  timeoutSeconds: 600,
}));

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const env = await TestWorkflowEnvironment.createLocal();
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: WORKFLOWS_PATH,
    activities,
  });
  const running = worker.run();

  async function capture(name: string, type: string, workflowId: string, evalId: string): Promise<void> {
    const handle = await env.client.workflow.start(type, {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [{ evalId }],
    });
    await handle.result();
    const history = await handle.fetchHistory();
    const json = proto.temporal.api.history.v1.History.fromObject(history).toJSON();
    writeFileSync(`${OUT_DIR}/${name}.json`, JSON.stringify(json, null, 2) + "\n");
    console.log(`captured ${name}.json`);
  }

  if (ONLY === undefined || ONLY === "plugin") {
    plan = { kind: "run", org: "acme", cells: CELLS, maxCostUsd: 10, concurrency: 1 };
    await capture("plugin-eval-completed", "stigmer/evals/run-plugin-eval", "plugin-eval/evr_replay", "evr_replay");
  }
  if (ONLY === undefined || ONLY === "agent") {
    plan = { kind: "run", org: "acme", cells: CELLS, maxCostUsd: 10, concurrency: 1, caseWorkflowPrefix: "agent-eval" };
    await capture("agent-eval-completed", "stigmer/evals/run-agent-eval", "agent-eval/aev_replay", "aev_replay");
  }

  worker.shutdown();
  await running;
  await env.teardown();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

/**
 * Captures eval suite workflow histories for the evals' replay determinism
 * gate (src/temporal/evals/__tests__/replay.test.ts): a suite lives for
 * hours to days, so one in flight WILL straddle a release, and every
 * change to the suite or case workflow must replay the committed
 * histories green, or be gated with patched().
 *
 * Two scenarios, each one case with one AI-graded check tried in both
 * arms, so the history holds child workflows under their ids in both arms,
 * votes and records:
 *
 *   - eval-run-plugin-completed: an eval run about a plugin, with and
 *     without it;
 *   - eval-run-agent-compare-completed: an eval run about an agent
 *     comparing a plugin it attaches, two tries per arm.
 *
 * Mock data only, safe to commit. Writes proto-JSON to
 * src/temporal/evals/__tests__/replay-histories/. Regenerate a history only
 * when no producing release is still supported.
 *
 * Usage: npx tsx scripts/capture-eval-replay-histories.ts [--only plugin|agent-compare] [--workflows <path to workflows/index.ts>]
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

/** The plan the load answers: the scenario's tries of case 0. */
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

/** `runs` tries of case 0 in each arm, the with arm's first, as the matrix orders them. */
function cells(runs: number) {
  return (["with", "without"] as const).flatMap((arm) =>
    Array.from({ length: runs }, (_, tryIndex) => ({ caseIndex: 0, targetIndex: 0, arm, tryIndex, timeoutSeconds: 600 })),
  );
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
    plan = { kind: "run", org: "acme", cells: cells(1), maxCostUsd: 10, concurrency: 1 };
    await capture("eval-run-plugin-completed", "stigmer/evals/eval-run", "eval-run/evr_replay", "evr_replay");
  }
  if (ONLY === undefined || ONLY === "agent-compare") {
    plan = { kind: "run", org: "acme", cells: cells(2), maxCostUsd: 10, concurrency: 2 };
    await capture("eval-run-agent-compare-completed", "stigmer/evals/eval-run", "eval-run/evr_compare", "evr_compare");
  }

  worker.shutdown();
  await running;
  await env.teardown();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

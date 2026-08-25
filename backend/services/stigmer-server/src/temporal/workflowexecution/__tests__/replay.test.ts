/**
 * Replay determinism gate for the workflow-execution orchestrator — the
 * twin of the agentexecution gate (see its header for the OD-6
 * discipline): committed histories from released workflow code must
 * replay green on the CURRENT code; a red run means a change is not
 * replay-safe for in-flight executions and needs patched(), never a
 * history regeneration.
 *
 * Fully local (no Temporal server needed). Histories are captured by
 * scripts/capture-wfexec-replay-histories.ts (mock payloads only).
 * The replay worker loads test-workflows.ts because the captured
 * histories' child-workflow references resolve against the same barrel
 * that produced them; the orchestrator under replay is the REAL one.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import proto from "@temporalio/proto";
import { Worker } from "@temporalio/worker";
import { describe, expect, it } from "vitest";

const HISTORY_DIR = fileURLToPath(
  new URL("./replay-histories", import.meta.url),
);
const WORKFLOWS_PATH = fileURLToPath(
  new URL("./test-workflows.ts", import.meta.url),
);

const historyFiles = readdirSync(HISTORY_DIR).filter((name) =>
  name.endsWith(".json"),
);

describe("invoke-workflow-execution replay determinism", () => {
  it("has committed histories to replay (the gate cannot be empty)", () => {
    expect(historyFiles.length).toBeGreaterThanOrEqual(3);
  });

  it("replays every committed history deterministically", async () => {
    // ONE runReplayHistories call for all files (the agentexecution
    // gate's native-runtime-handle rationale).
    const histories = historyFiles.map((file) => ({
      workflowId: file,
      history: proto.temporal.api.history.v1.History.fromObject(
        JSON.parse(readFileSync(`${HISTORY_DIR}/${file}`, "utf8")),
      ),
    }));
    const results = await Worker.runReplayHistories(
      { workflowsPath: WORKFLOWS_PATH },
      histories,
    );
    for await (const result of results) {
      expect(
        result.error,
        `history ${result.workflowId} must replay without nondeterminism`,
      ).toBeUndefined();
    }
  }, 120_000);
});

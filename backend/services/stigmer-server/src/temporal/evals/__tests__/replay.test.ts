/**
 * Replay determinism gate for the eval workflows: committed suite histories
 * must replay green on the CURRENT workflow code. A suite runs for hours to
 * days, so one in flight straddles a release; a red run here means a change
 * to the suite or case workflow is not replay-safe for evals in flight, and
 * must be gated with patched() instead.
 *
 * `eval-run-plugin-completed` is an eval run about a plugin, one try in
 * each arm; `eval-run-agent-compare-completed` an eval run about an agent
 * comparing a plugin it attaches, two tries in each arm, two at once.
 *
 * Fully local: replay needs no Temporal server. Histories are captured by
 * scripts/capture-eval-replay-histories.ts (mock payloads only).
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import proto from "@temporalio/proto";
import { Worker } from "@temporalio/worker";
import { describe, expect, it } from "vitest";

const HISTORY_DIR = fileURLToPath(new URL("./replay-histories", import.meta.url));
const WORKFLOWS_PATH = fileURLToPath(new URL("../workflows/index.ts", import.meta.url));

const historyFiles = readdirSync(HISTORY_DIR).filter((name) => name.endsWith(".json"));

describe("eval workflows' replay determinism", () => {
  it("has an eval run about a plugin's and one comparing a plugin on an agent's history to replay", () => {
    expect(historyFiles).toEqual(
      expect.arrayContaining(["eval-run-plugin-completed.json", "eval-run-agent-compare-completed.json"]),
    );
  });

  it("replays every committed history deterministically", async () => {
    // One runReplayHistories call for every file: the native bridge serves
    // one replay worker at a time.
    const histories = historyFiles.map((file) => ({
      workflowId: file,
      history: proto.temporal.api.history.v1.History.fromObject(
        JSON.parse(readFileSync(`${HISTORY_DIR}/${file}`, "utf8")),
      ),
    }));
    const results = Worker.runReplayHistories({ workflowsPath: WORKFLOWS_PATH }, histories);
    for await (const result of results) {
      expect(result.error, `history ${result.workflowId} must replay deterministically`).toBeUndefined();
    }
  }, 120_000);
});

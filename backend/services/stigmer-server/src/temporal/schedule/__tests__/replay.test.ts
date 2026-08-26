/**
 * Replay determinism gate for the schedule/tick workflow — the OD-6
 * discipline this domain ORIGINATED (Go tick_replay_test.go, whose rule
 * the agent-execution gate adopted at #18; this port brings it home):
 * committed histories from released workflow code must replay green on
 * the CURRENT code. A red run here means a change to the tick's logic is
 * NOT replay-safe for in-flight ticks — ticks live for minutes-to-an-hour
 * and OSS releases cut every 1-3 days, so an in-flight tick WILL straddle
 * a binary upgrade. Gate changes with patched()/deprecatePatch(); never
 * regenerate the histories while a producing release is supported.
 *
 * Fully local: replay needs no Temporal server, so this gate runs in the
 * plain vitest suite (and the ci.stigmer-server workflow) on every
 * change. Histories are captured by
 * scripts/capture-schedule-replay-histories.ts (mock payloads only).
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import proto from "@temporalio/proto";
import { Worker } from "@temporalio/worker";
import { describe, expect, it } from "vitest";

const HISTORY_DIR = fileURLToPath(new URL("./replay-histories", import.meta.url));
const WORKFLOWS_PATH = fileURLToPath(new URL("../workflows/index.ts", import.meta.url));

const historyFiles = readdirSync(HISTORY_DIR).filter((name) =>
  name.endsWith(".json"),
);

describe("schedule/tick replay determinism", () => {
  it("has committed histories to replay (the gate cannot be empty)", () => {
    expect(historyFiles.length).toBeGreaterThanOrEqual(3);
  });

  it("replays every committed history deterministically", async () => {
    // ONE runReplayHistories call for all files (the agent-execution
    // gate's native-bridge constraint applies here identically).
    const histories = historyFiles.map((file) => ({
      workflowId: file,
      history: proto.temporal.api.history.v1.History.fromObject(
        JSON.parse(readFileSync(`${HISTORY_DIR}/${file}`, "utf8")),
      ),
    }));
    const results = Worker.runReplayHistories(
      { workflowsPath: WORKFLOWS_PATH },
      histories,
    );
    for await (const result of results) {
      expect(
        result.error,
        `history ${result.workflowId} must replay deterministically`,
      ).toBeUndefined();
    }
  }, 120_000);
});

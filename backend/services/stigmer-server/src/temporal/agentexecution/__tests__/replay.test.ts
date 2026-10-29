/**
 * Replay determinism gate — the go-forward discipline:
 * committed histories from released workflow code must replay green on
 * the CURRENT code. A red run here means a change to the workflow's
 * logic is NOT replay-safe for in-flight executions: gate it with
 * patched()/deprecatePatch(), never regenerate the histories (regenerate
 * only when no producing release is still supported).
 *
 * Fully local: replay needs no Temporal server, so this gate runs in the
 * plain vitest suite (and the ci.stigmer-server workflow) on every
 * change. Histories are captured by scripts/capture-replay-histories.ts
 * (mock payloads only).
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
  new URL("../workflows/index.ts", import.meta.url),
);

const historyFiles = readdirSync(HISTORY_DIR).filter((name) =>
  name.endsWith(".json"),
);

describe("invoke-agent-execution replay determinism", () => {
  it("has committed histories to replay (the gate cannot be empty)", () => {
    // One history per scenario of scripts/capture-replay-histories.ts: a
    // completed turn, a HITL approval cycle, a pause and resume, a failure
    // the runner reported, a user's cancel, a drained turn recovered, a
    // drained turn that continued, and a Claude turn's HITL cycle on the
    // deterministic-state flow.
    expect(historyFiles.length).toBeGreaterThanOrEqual(8);
  });

  it("replays every committed history deterministically", async () => {
    // ONE runReplayHistories call for all files: one native runtime, one
    // workflow bundle — per-history runReplayHistory calls in the same
    // process trip a native-bridge runtime-handle error in the pinned
    // SDK. History.fromObject is the exact inverse of the capture
    // script's toJSON (see scripts/capture-replay-histories.ts for why
    // the SDK's historyFromJSON pair is not usable here).
    const histories = historyFiles.map((file) => ({
      workflowId: file,
      history: proto.temporal.api.history.v1.History.fromObject(
        JSON.parse(readFileSync(`${HISTORY_DIR}/${file}`, "utf8")),
      ),
    }));
    // Throws on any nondeterminism between a history and current code.
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

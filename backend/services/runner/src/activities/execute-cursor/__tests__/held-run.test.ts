/**
 * Unit tests for `held-run.ts`: what a resumed local Cursor agent holds from
 * the process before this one (stigmer#2487).
 *
 * Two facts decide a resumed turn's first send, and a revert of either is
 * what this file catches:
 *
 * - the held run is open only while the agent's active run is queued or
 *   running in its store; a finished, cancelled or expired run, or no active
 *   run at all, is not held, so the send is not forced;
 * - the record names this run only for the same run on the same agent; a
 *   record of another run, or of another agent (a fresh agent after a failed
 *   resume), does not continue the turn, and a missing or unreadable record
 *   reads as no send at all, so the task goes once, while a record that
 *   cannot be read for another reason fails the turn instead of guessing.
 *
 * The store is a fake carrying the two reads the module makes; the record is
 * a real file in a temporary state root.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalAgentRunStatus } from "@cursor/sdk";

import { NOTHING_HELD, SENT_RUN_FILE, readHeldRun, readSentRun, recordSentRun, type HeldRunStore } from "../held-run.js";

const tempRoots: string[] = [];

function freshStateRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "stigmer-held-run-test-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A store whose agent `agent-1` holds `run-1` with `status`, or no active run when `status` is absent. */
function storeHolding(status?: LocalAgentRunStatus): HeldRunStore {
  return {
    agents: {
      get: async ({ agentId }) =>
        agentId === "agent-1"
          ? { agentId, cwd: "", status: "idle", activeRunId: status === undefined ? null : "run-1", createdAt: 0, updatedAt: 0 }
          : null,
    },
    runs: {
      get: async ({ agentId, runId }) =>
        agentId === "agent-1" && runId === "run-1" && status !== undefined ? { runId, agentId, turnNumber: 1, status, createdAt: 0, updatedAt: 0 } : null,
    },
  };
}

describe("the sent-run record", () => {
  it("reads back the newest send, and leaves no pending file behind", async () => {
    const root = freshStateRoot();
    await recordSentRun(root, { executionId: "aex-1", agentId: "agent-1", runId: "run-1" });
    await recordSentRun(root, { executionId: "aex-2", agentId: "agent-1", runId: "run-2" });
    expect(await readSentRun(root)).toEqual({ executionId: "aex-2", agentId: "agent-1", runId: "run-2" });
    expect(readdirSync(root)).toEqual([SENT_RUN_FILE]);
  });

  it("reads as no send when nothing was recorded", async () => {
    expect(await readSentRun(freshStateRoot())).toBeUndefined();
  });

  it("reads as no send when the record is not one", async () => {
    const root = freshStateRoot();
    writeFileSync(join(root, SENT_RUN_FILE), "{not json");
    expect(await readSentRun(root)).toBeUndefined();
    writeFileSync(join(root, SENT_RUN_FILE), JSON.stringify({ executionId: "aex-1", agentId: 7 }));
    expect(await readSentRun(root)).toBeUndefined();
    writeFileSync(join(root, SENT_RUN_FILE), "null");
    expect(await readSentRun(root)).toBeUndefined();
  });

  it("fails loudly when the record cannot be read for any reason but its absence", async () => {
    const root = freshStateRoot();
    mkdirSync(join(root, SENT_RUN_FILE));
    await expect(readSentRun(root)).rejects.toThrow(/EISDIR/);
  });
});

describe("readHeldRun", () => {
  it.each<LocalAgentRunStatus>(["queued", "running"])("holds the run open while it is %s", async (status) => {
    const held = await readHeldRun(storeHolding(status), freshStateRoot(), "agent-1", "aex-1");
    expect(held.open).toBe(true);
  });

  it.each<LocalAgentRunStatus>(["finished", "error", "cancelled", "expired"])("holds nothing open once the run is %s", async (status) => {
    const held = await readHeldRun(storeHolding(status), freshStateRoot(), "agent-1", "aex-1");
    expect(held.open).toBe(false);
  });

  it("holds nothing open for an agent with no active run, or one the store does not know", async () => {
    const root = freshStateRoot();
    expect(await readHeldRun(storeHolding(), root, "agent-1", "aex-1")).toEqual(NOTHING_HELD);
    expect(await readHeldRun(storeHolding("running"), root, "agent-2", "aex-1")).toEqual(NOTHING_HELD);
  });

  it("names this run only when the record is this run's, on this agent", async () => {
    const root = freshStateRoot();
    await recordSentRun(root, { executionId: "aex-1", agentId: "agent-1", runId: "run-1" });
    const store = storeHolding("running");
    expect(await readHeldRun(store, root, "agent-1", "aex-1")).toEqual({ open: true, sentForThisRun: true });
    expect((await readHeldRun(store, root, "agent-1", "aex-2")).sentForThisRun).toBe(false);
    expect((await readHeldRun(store, root, "agent-2", "aex-1")).sentForThisRun).toBe(false);
  });
});

/**
 * Live smoke: the Cursor SDK authenticates and completes a round trip on a
 * real member key. Three arms, each isolating one fact:
 *  1. `Agent.create()` with a model named succeeds — the key is valid;
 *  2. `agent.send()` runs to a completed result — the agent executes and the
 *     transport completes the round trip;
 *  3. `Agent.create()` with no model named succeeds — the catalog default
 *     resolves.
 *
 * Skipped without `CURSOR_API_KEY`; the suite never runs it. Run it by hand:
 *   CURSOR_API_KEY=<key> npx vitest run src/activities/execute-cursor/__tests__/cursor-sdk-auth-smoke.test.ts
 * Last run green 3/3 on 2026-09-16 at SDK 1.0.31 (#1097's live run).
 */

import { describe, it, expect } from "vitest";
import { Agent } from "@cursor/sdk";
import { SqliteLocalAgentStore } from "@cursor/sdk/sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CURSOR_API_KEY = process.env.CURSOR_API_KEY ?? "";

// Live smoke test: requires a real Cursor API key. Skipped when none is set
// (e.g. local `make check` / CI without provider credentials).
const describeWithCursorKey = CURSOR_API_KEY ? describe : describe.skip;

describeWithCursorKey("Cursor SDK Authentication Smoke Test", () => {

  it("Agent.create() succeeds with a valid API key", async () => {
    const stateRoot = join(tmpdir(), `cursor-auth-test-${Date.now()}`);
    mkdirSync(stateRoot, { recursive: true });

    const agent = await Agent.create({
      apiKey: CURSOR_API_KEY,
      model: { id: "claude-sonnet-4" },
      local: {
        cwd: stateRoot,
        // 1.0.31: the store is caller-owned (`session-store.ts` in production).
        store: await SqliteLocalAgentStore.open({ workspaceRef: `auth-test-${Date.now()}`, stateRoot }),
      },
    });

    expect(agent).toBeDefined();
    expect(agent.agentId).toBeTruthy();
    console.log(`Agent created successfully: agentId=${agent.agentId}`);
  }, 30_000);

  it("agent.send() produces a response (full auth round-trip)", async () => {
    const stateRoot = join(tmpdir(), `cursor-send-test-${Date.now()}`);
    mkdirSync(stateRoot, { recursive: true });

    const agent = await Agent.create({
      apiKey: CURSOR_API_KEY,
      model: { id: "claude-sonnet-4" },
      local: {
        cwd: stateRoot,
        // 1.0.31: the store is caller-owned (`session-store.ts` in production).
        store: await SqliteLocalAgentStore.open({ workspaceRef: `send-test-${Date.now()}`, stateRoot }),
      },
    });

    expect(agent.agentId).toBeTruthy();

    const run = await agent.send("Reply with exactly: auth-test-ok");

    const result = await run.wait();
    expect(result).toBeDefined();
    expect(["completed", "finished"]).toContain(result.status);
    console.log(
      `Agent.send() completed: runId=${result.id}, status=${result.status}, ` +
      `durationMs=${result.durationMs}`,
    );
  }, 120_000);

  it("Agent.create() with default model (no explicit model)", async () => {
    const stateRoot = join(tmpdir(), `cursor-default-model-test-${Date.now()}`);
    mkdirSync(stateRoot, { recursive: true });

    const agent = await Agent.create({
      apiKey: CURSOR_API_KEY,
      local: {
        cwd: stateRoot,
        // 1.0.31: the store is caller-owned (`session-store.ts` in production).
        store: await SqliteLocalAgentStore.open({ workspaceRef: `default-model-test-${Date.now()}`, stateRoot }),
      },
    });

    expect(agent).toBeDefined();
    expect(agent.agentId).toBeTruthy();
    console.log(`Agent created with default model: agentId=${agent.agentId}`);
  }, 30_000);
});

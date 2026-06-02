/**
 * Minimal smoke test to verify Cursor SDK authentication works with a real API key.
 *
 * Tests three things in isolation:
 * 1. Agent.create() succeeds (proves the API key is valid)
 * 2. agent.send() produces a response (proves the agent can execute)
 * 3. The connect-node transport works end-to-end
 *
 * Run with: CURSOR_API_KEY=<key> npx tsx --test this-file.ts
 * Or via the test script: npm run test:cursor-auth
 */

import { describe, it, expect } from "vitest";
import { Agent } from "@cursor/sdk";
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
      local: { cwd: stateRoot },
      platform: {
        workspaceRef: `auth-test-${Date.now()}`,
        stateRoot,
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
      local: { cwd: stateRoot },
      platform: {
        workspaceRef: `send-test-${Date.now()}`,
        stateRoot,
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
      local: { cwd: stateRoot },
      platform: {
        workspaceRef: `default-model-test-${Date.now()}`,
        stateRoot,
      },
    });

    expect(agent).toBeDefined();
    expect(agent.agentId).toBeTruthy();
    console.log(`Agent created with default model: agentId=${agent.agentId}`);
  }, 30_000);
});

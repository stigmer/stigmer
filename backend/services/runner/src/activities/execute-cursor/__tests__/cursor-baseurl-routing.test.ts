/**
 * Test that the SDK works correctly when CURSOR_BACKEND_URL is unset.
 *
 * In proxy mode, only CURSOR_API_BASE_URL is set (for Connect RPC).
 * CURSOR_BACKEND_URL is left unset so the SDK uses its built-in defaults:
 *   - CloudApiClient → api.cursor.com (REST: /v1/models, CRUD)
 *   - Token exchange → api2.cursor.sh (/auth/exchange_user_api_key)
 *
 * This test verifies:
 *   1. Model validation (GET /v1/models) works with real API key when
 *      CURSOR_BACKEND_URL is unset (routes to api.cursor.com by default)
 *   2. Agent execution works end-to-end (token exchange + Connect RPC)
 *
 * NOTE: CURSOR_API_BASE_URL routing cannot be tested from vitest because
 * the native SDK binary reads it at process startup, not at import time.
 * That routing is validated by the production code in main.ts which sets
 * the env var BEFORE any SDK import.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CURSOR_API_KEY = process.env.CURSOR_API_KEY ?? "";

// Live smoke test: requires a real Cursor API key. Skipped when none is set
// (e.g. local `make check` / CI without provider credentials).
const describeWithCursorKey = CURSOR_API_KEY ? describe : describe.skip;

describeWithCursorKey("SDK routing with CURSOR_BACKEND_URL unset", () => {
  beforeAll(() => {
    // Ensure CURSOR_BACKEND_URL is unset — the SDK should use its built-in
    // defaults for REST calls (model validation → api.cursor.com, token
    // exchange → api2.cursor.sh).
    delete process.env.CURSOR_BACKEND_URL;
  });

  it("Agent.create() with explicit model succeeds (model validation via default api.cursor.com)", async () => {
    const stateRoot = join(tmpdir(), `cursor-routing-test-${Date.now()}`);
    mkdirSync(stateRoot, { recursive: true });

    const { Agent } = await import("@cursor/sdk");

    const agent = await Agent.create({
      apiKey: CURSOR_API_KEY,
      model: { id: "claude-sonnet-4" },
      local: { cwd: stateRoot },
      platform: {
        workspaceRef: `routing-test-${Date.now()}`,
        stateRoot,
      },
    });

    expect(agent).toBeDefined();
    expect(agent.agentId).toBeTruthy();
    console.log(`Agent created with model validation: agentId=${agent.agentId}`);
  }, 30_000);

  it("agent.send() succeeds (token exchange + Connect RPC round-trip)", async () => {
    const stateRoot = join(tmpdir(), `cursor-routing-send-${Date.now()}`);
    mkdirSync(stateRoot, { recursive: true });

    const { Agent } = await import("@cursor/sdk");

    const agent = await Agent.create({
      apiKey: CURSOR_API_KEY,
      model: { id: "claude-sonnet-4" },
      local: { cwd: stateRoot },
      platform: {
        workspaceRef: `routing-send-test-${Date.now()}`,
        stateRoot,
      },
    });

    const run = await agent.send("Reply with exactly: routing-test-ok");
    const result = await run.wait();

    expect(result).toBeDefined();
    expect(["completed", "finished"]).toContain(result.status);
    console.log(
      `Full round-trip succeeded: runId=${result.id}, status=${result.status}, ` +
      `durationMs=${result.durationMs}`,
    );
  }, 120_000);
});

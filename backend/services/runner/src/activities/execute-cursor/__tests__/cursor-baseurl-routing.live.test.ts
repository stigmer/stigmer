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
 *
 * The model is `composer-2.5`, the one the other live instruments and the
 * hermetic fixture pin: the arms prove routing, which no model choice changes.
 *
 * Live class (`*.live.test.ts`): runs only through `npm run test:live`, by
 * hand or in the live lane; skips without `CURSOR_API_KEY` outside the lane
 * (`src/__test-utils__/live-gate.ts`). Each arm is one short turn with no
 * product cost cap (the SDK is driven directly, not through an execution).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { liveSecret } from "../../../__test-utils__/live-gate.js";

const CURSOR_API_KEY = liveSecret("CURSOR_API_KEY") ?? "";

describe.skipIf(!liveSecret("CURSOR_API_KEY"))("SDK routing with CURSOR_BACKEND_URL unset", () => {
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
    const { SqliteLocalAgentStore } = await import("@cursor/sdk/sqlite");

    const agent = await Agent.create({
      apiKey: CURSOR_API_KEY,
      model: { id: "composer-2.5" },
      local: {
        cwd: stateRoot,
        // 1.0.31: the store is caller-owned (`session-store.ts` in production).
        store: await SqliteLocalAgentStore.open({ workspaceRef: `routing-test-${Date.now()}`, stateRoot }),
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
    const { SqliteLocalAgentStore } = await import("@cursor/sdk/sqlite");

    const agent = await Agent.create({
      apiKey: CURSOR_API_KEY,
      model: { id: "composer-2.5" },
      local: {
        cwd: stateRoot,
        // 1.0.31: the store is caller-owned (`session-store.ts` in production).
        store: await SqliteLocalAgentStore.open({ workspaceRef: `routing-send-test-${Date.now()}`, stateRoot }),
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

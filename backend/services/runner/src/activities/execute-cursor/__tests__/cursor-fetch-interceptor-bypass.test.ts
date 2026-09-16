/**
 * Live probe: which of the SDK's calls a `globalThis.fetch` interceptor can
 * see. A fetch wrapper that notes any call to a cursor.sh / cursor.com URL is
 * installed, then `Agent.create()` runs (local mode, no model named).
 *
 * What the one arm proves: `Agent.create()` completes WITHOUT a global-fetch
 * call to a Cursor URL — its transport is connect-node over Node's HTTP/2, so
 * a fetch-level interceptor alone cannot rewrite it. That is why the adapter
 * installs BOTH interceptors in proxy mode (`fetch-interceptor.ts` and
 * `http2-interceptor.ts`). Measured true at SDK 1.0.31 on 2026-09-16 (#1097's
 * live run, 1/1).
 *
 * What it does NOT prove: that the fetch interceptor is useless. A reading of
 * the 1.0.31 bundle the same day found the SDK's cloud-api client and its
 * token exchange on global `fetch`, on paths this arm never exercises; the
 * fetch interceptor exists for those.
 *
 * Skipped without `CURSOR_API_KEY`; the suite never runs it. Run it by hand:
 *   CURSOR_API_KEY=<key> npx vitest run src/activities/execute-cursor/__tests__/cursor-fetch-interceptor-bypass.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CURSOR_API_KEY = process.env.CURSOR_API_KEY ?? "";

// Live smoke test: requires a real Cursor API key. Skipped when none is set
// (e.g. local `make check` / CI without provider credentials).
const describeWithCursorKey = CURSOR_API_KEY ? describe : describe.skip;

describeWithCursorKey("Fetch Interceptor vs Connect-Node Transport", () => {
  let interceptCalled = false;
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    interceptCalled = false;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("cursor.sh") || url.includes("cursor.com")) {
        interceptCalled = true;
        console.log(`[INTERCEPTOR HIT] ${url}`);
      }
      return originalFetch(input, init);
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("Agent.create() completes without a globalThis.fetch call to a Cursor URL", async () => {
    const { Agent } = await import("@cursor/sdk");
    const { SqliteLocalAgentStore } = await import("@cursor/sdk/sqlite");

    const stateRoot = join(tmpdir(), `cursor-intercept-test-${Date.now()}`);
    mkdirSync(stateRoot, { recursive: true });

    const agent = await Agent.create({
      apiKey: CURSOR_API_KEY,
      local: {
        cwd: stateRoot,
        // 1.0.31: the store is caller-owned (`session-store.ts` in production).
        store: await SqliteLocalAgentStore.open({ workspaceRef: `intercept-test-${Date.now()}`, stateRoot }),
      },
    });

    expect(agent.agentId).toBeTruthy();
    console.log(`Agent created: ${agent.agentId}, interceptCalled=${interceptCalled}`);

    // The create path is connect-node over Node's HTTP/2, not globalThis.fetch;
    // see the header for what this does and does not say about proxy mode.
    expect(interceptCalled).toBe(false);
  }, 30_000);
});

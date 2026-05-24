/**
 * Test that reproduces the desktop runner's EXACT execution path.
 *
 * Simulates proxy mode: fetch interceptor installed, apiKey="proxy-managed",
 * to verify whether the proxy rewriting actually intercepts @cursor/sdk calls.
 *
 * Expected result: THIS TEST WILL FAIL because @cursor/sdk uses connect-node
 * (Node.js native HTTP), not globalThis.fetch. The fetch interceptor never fires.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CURSOR_API_KEY = process.env.CURSOR_API_KEY ?? "";

describe("Fetch Interceptor vs Connect-Node Transport", () => {
  let interceptCalled = false;
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    if (!CURSOR_API_KEY) {
      throw new Error("CURSOR_API_KEY not set");
    }

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

  it("Agent.create() does NOT go through globalThis.fetch (proving interceptor is useless)", async () => {
    const { Agent } = await import("@cursor/sdk");

    const stateRoot = join(tmpdir(), `cursor-intercept-test-${Date.now()}`);
    mkdirSync(stateRoot, { recursive: true });

    const agent = await Agent.create({
      apiKey: CURSOR_API_KEY,
      local: { cwd: stateRoot },
      platform: {
        workspaceRef: `intercept-test-${Date.now()}`,
        stateRoot,
      },
    });

    expect(agent.agentId).toBeTruthy();
    console.log(`Agent created: ${agent.agentId}, interceptCalled=${interceptCalled}`);

    // This assertion proves the fetch interceptor pattern is broken:
    // connect-node uses Node.js http module, NOT globalThis.fetch
    expect(interceptCalled).toBe(false);
  }, 30_000);
});

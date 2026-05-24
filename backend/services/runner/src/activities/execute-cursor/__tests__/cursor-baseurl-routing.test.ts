/**
 * Test that CURSOR_API_BASE_URL env var redirects SDK traffic.
 *
 * Verifies the proposed fix: setting CURSOR_API_BASE_URL to a proxy endpoint
 * causes the SDK to route Connect protocol requests to that URL instead of
 * the default api2.cursor.sh.
 *
 * We point it to a nonexistent local URL and expect a connection error
 * (not an auth error), proving the SDK respects the env var.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("CURSOR_API_BASE_URL env var routing", () => {
  beforeAll(() => {
    // Point SDK to a local endpoint that doesn't exist
    process.env.CURSOR_API_BASE_URL = "http://127.0.0.1:19999";
    process.env.CURSOR_BACKEND_URL = "http://127.0.0.1:19999";
  });

  it("agent.send() routes to CURSOR_API_BASE_URL instead of api2.cursor.sh", async () => {
    const { Agent } = await import("@cursor/sdk");

    const stateRoot = join(tmpdir(), `cursor-baseurl-test-${Date.now()}`);
    mkdirSync(stateRoot, { recursive: true });

    // With a model specified, the SDK validates it by calling GET /v1/models
    // at the base URL. This is where we expect the connection failure.
    try {
      const agent = await Agent.create({
        apiKey: "test-key-doesnt-matter",
        model: { id: "claude-sonnet-4" },
        local: { cwd: stateRoot },
        platform: {
          workspaceRef: `baseurl-test-${Date.now()}`,
          stateRoot,
        },
      });

      // If create succeeds, try send
      const run = await agent.send("hello");
      await run.wait();
      expect.fail("Should have failed to connect to nonexistent endpoint");
    } catch (err: any) {
      const msg = err.message ?? String(err);
      const cause = err.cause?.message ?? "";
      const causeOfCause = err.cause?.cause?.message ?? "";
      const allMsg = `${msg} ${cause} ${causeOfCause}`;
      console.log(`Error: ${msg}`);
      console.log(`Cause: ${cause}`);
      console.log(`CauseOfCause: ${causeOfCause}`);

      const isRoutedToOurEndpoint =
        allMsg.includes("ECONNREFUSED") ||
        allMsg.includes("127.0.0.1:19999") ||
        allMsg.includes("Network request failed");

      const isCursorAuthError =
        allMsg.includes("cursor.sh") ||
        allMsg.includes("cursor.com") ||
        allMsg.includes("unauthenticated");

      console.log(`routedToCustomEndpoint=${isRoutedToOurEndpoint}, cursorAuthError=${isCursorAuthError}`);

      if (isRoutedToOurEndpoint) {
        console.log("PROVEN: SDK respects CURSOR_API_BASE_URL for routing");
      }

      expect(isRoutedToOurEndpoint).toBe(true);
      expect(isCursorAuthError).toBe(false);
    }
  }, 15_000);
});

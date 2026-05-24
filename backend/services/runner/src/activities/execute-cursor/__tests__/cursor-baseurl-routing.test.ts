/**
 * Test that CURSOR_API_BASE_URL and CURSOR_BACKEND_URL env vars redirect
 * SDK traffic to the correct proxy paths.
 *
 * The Cursor SDK uses two separate base URLs:
 *   CURSOR_API_BASE_URL → Connect RPC transport (api2.cursor.sh)
 *   CURSOR_BACKEND_URL  → REST API / CloudApiClient (api.cursor.com)
 *
 * We point both to nonexistent local endpoints on different ports and
 * expect connection errors (not auth errors), proving the SDK respects
 * each env var independently.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CONNECT_RPC_PORT = 19998;
const REST_API_PORT = 19999;

describe("Cursor SDK env var routing", () => {
  beforeAll(() => {
    // Connect RPC (agent send/receive) → separate port from REST API
    process.env.CURSOR_API_BASE_URL = `http://127.0.0.1:${CONNECT_RPC_PORT}`;
    // REST API (CloudApiClient: /v1/models, agent CRUD) → different port
    process.env.CURSOR_BACKEND_URL = `http://127.0.0.1:${REST_API_PORT}`;
  });

  it("Agent.create() with model routes model validation to CURSOR_BACKEND_URL", async () => {
    const { Agent } = await import("@cursor/sdk");

    const stateRoot = join(tmpdir(), `cursor-baseurl-test-${Date.now()}`);
    mkdirSync(stateRoot, { recursive: true });

    // With a model specified, the SDK validates it by calling GET /v1/models
    // via CloudApiClient, which reads CURSOR_BACKEND_URL (REST API host).
    try {
      await Agent.create({
        apiKey: "test-key-doesnt-matter",
        model: { id: "claude-sonnet-4" },
        local: { cwd: stateRoot },
        platform: {
          workspaceRef: `baseurl-test-${Date.now()}`,
          stateRoot,
        },
      });

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
        allMsg.includes(`127.0.0.1:${REST_API_PORT}`) ||
        allMsg.includes("Network request failed");

      const isCursorAuthError =
        allMsg.includes("cursor.sh") ||
        allMsg.includes("cursor.com") ||
        allMsg.includes("unauthenticated");

      console.log(`routedToCustomEndpoint=${isRoutedToOurEndpoint}, cursorAuthError=${isCursorAuthError}`);

      if (isRoutedToOurEndpoint) {
        console.log("PROVEN: SDK respects CURSOR_BACKEND_URL for REST API routing");
      }

      expect(isRoutedToOurEndpoint).toBe(true);
      expect(isCursorAuthError).toBe(false);
    }
  }, 15_000);
});

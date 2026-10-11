/**
 * Regression pin for issue #239's hang mechanism, against the REAL MCP client
 * stack (no @langchain/mcp-adapters mock — that is why this lives apart from
 * mcp-tool-listing.test.ts's mocked suite).
 *
 * The monday.com failure shape: the endpoint answers the streamable-HTTP
 * initialize POST with a 4xx, mcp-adapters falls back to SSE at the same URL,
 * the endpoint accepts the stream and never sends the legacy `endpoint`
 * event, and the MCP SDK's SSEClientTransport has no timer of its own, so
 * initialization would hang forever. This pins that a tools listing fails
 * within the HTTP init bound (in fake time) with an error naming the endpoint.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";

import { listServerTools } from "../mcp-tool-listing.js";

// A failed HTTP listing re-probes the endpoint for a sign-in challenge; keep
// it deterministic here (its own behaviour is covered by mcp-oauth-detect's tests).
vi.mock("../mcp-oauth-detect.js", () => ({
  detectOAuthChallenge: vi.fn().mockResolvedValue(null),
}));

describe("a tools listing against a 4xx-then-silent-SSE endpoint (issue #239)", () => {
  let server: Server;
  let url: string;

  beforeEach(async () => {
    server = createServer((req, res) => {
      if (req.method === "POST") {
        // monday-shaped: reject the streamable-HTTP initialize outright.
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "method not allowed" }));
        return;
      }
      // The SSE fallback: accept the stream, never send an `endpoint` event.
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": silent stream\n\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("no port");
    url = `http://127.0.0.1:${address.port}/mcp`;
  });

  afterEach(() => {
    // closeAllConnections: the hung SSE stream is a live socket that would
    // otherwise keep server.close() (and the vitest worker) waiting.
    server.closeAllConnections();
    server.close();
    vi.useRealTimers();
  });

  it("fails within the HTTP init bound with an endpoint-naming error", async () => {
    // shouldAdvanceTime keeps real I/O flowing (the POST → 405 → SSE fallback
    // happens over real sockets) while letting the test jump the bound.
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const promise = listServerTools({
      slug: "plugin_monday_api",
      connectionType: "http",
      url,
      pluginOrigin: { pluginId: "plg-monday", plugin: "monday", server: "api" },
    });
    // Attach the rejection expectation BEFORE advancing so the rejection is
    // never momentarily unhandled.
    const expectation = expect(promise).rejects.toThrow(
      new RegExp(`at ${url.replaceAll(".", "\\.")}.*did not complete MCP initialization`, "s"),
    );

    // Give the real client a beat to reach the hang (POST + fallback), then
    // jump past the 30s HTTP bound in fake time.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await vi.advanceTimersByTimeAsync(31_000);

    await expectation;
  }, 15_000);
});

// HTTP transport hardening + OAuth discovery tests.
//
// Boots the real Streamable HTTP transport on a loopback port and exercises the
// additive surface added in Phase 6: the /health probe, RFC 9728 protected
// resource metadata (GET + CORS preflight), and the WWW-Authenticate challenge
// on token-less requests. Token validation is never performed here — presence is
// the only check (Go parity: internal/server/http.go).

import { createServer as createNetServer, type AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Config } from "./config";
import { configureLogger } from "./logger";
import { routedServerFactory, serveHttp } from "./server";

configureLogger({ level: "error", format: "text" });

let port: number;
let controller: AbortController;
let serving: Promise<void>;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createNetServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

beforeAll(async () => {
  port = await freePort();
  const cfg: Config = {
    stigmerServerAddress: "localhost:7234",
    apiKey: "",
    transport: "http",
    roster: "full",
    httpPort: String(port),
    httpAuthEnabled: true,
    oauth: {
      enabled: true,
      resource: "https://mcp.stigmer.ai",
      authorizationServers: ["https://auth.example.com"],
      scopesSupported: ["read", "write"],
    },
    logFormat: "text",
    logLevel: "error",
  };
  controller = new AbortController();
  // The REAL route dispatch, so these tests hold the production route
  // table: full roster on "/", channels on "/channels", conversation on
  // "/conversation", 404 anywhere else.
  serving = serveHttp(
    routedServerFactory({ serverAddress: cfg.stigmerServerAddress, apiKey: "" }),
    cfg,
    controller.signal,
  );
  // Give the listener a tick to bind.
  await new Promise((r) => setTimeout(r, 100));
});

afterAll(async () => {
  controller.abort();
  await serving;
});

const base = () => `http://127.0.0.1:${port}`;

describe("HTTP transport hardening + OAuth discovery", () => {
  it("answers the /health probe without auth", async () => {
    const res = await fetch(`${base()}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("serves RFC 9728 protected resource metadata", async () => {
    const res = await fetch(`${base()}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual({
      resource: "https://mcp.stigmer.ai",
      authorization_servers: ["https://auth.example.com"],
      bearer_methods_supported: ["header"],
      resource_name: "Stigmer MCP Server",
      scopes_supported: ["read", "write"],
    });
  });

  it("answers the CORS preflight for the metadata document", async () => {
    const res = await fetch(`${base()}/.well-known/oauth-protected-resource`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("challenges token-less requests with WWW-Authenticate", async () => {
    const res = await fetch(`${base()}/`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('realm="stigmer"');
    expect(challenge).toContain(
      'resource_metadata="https://mcp.stigmer.ai/.well-known/oauth-protected-resource"',
    );
    expect(challenge).toContain('scope="read write"');
  });

  it("rejects a malformed Authorization header as token-less", async () => {
    // A non-"Bearer " scheme yields an empty token and is treated as missing.
    const res = await fetch(`${base()}/`, {
      method: "POST",
      headers: { authorization: "Basic Zm9vOmJhcg==" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate") ?? "").toContain('realm="stigmer"');
  });

  it("returns 404 for an unknown MCP session even with a valid token", async () => {
    const res = await fetch(`${base()}/`, {
      method: "POST",
      headers: { authorization: "Bearer test-token", "mcp-session-id": "does-not-exist" },
      body: "{}",
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("unknown or expired MCP session");
  });

  it("rejects a sessionless non-initialize POST", async () => {
    const res = await fetch(`${base()}/`, {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("an initialize request is required");
  });

  it("rejects a sessionless GET (no Mcp-Session-Id)", async () => {
    const res = await fetch(`${base()}/`, {
      method: "GET",
      headers: { authorization: "Bearer test-token" },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("missing Mcp-Session-Id header");
  });
});

/** POST a real MCP initialize to `path`; returns the raw Response. */
function initialize(path: string): Promise<Response> {
  return fetch(`${base()}${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "http-integration", version: "test" },
      },
    }),
  });
}

describe("HTTP route dispatch (the closed route table)", () => {
  it.each([
    ["/", "mcp-server-stigmer"],
    ["/channels", "mcp-server-stigmer-channels"],
    ["/conversation", "mcp-server-stigmer-conversation"],
  ])("serves the %s roster as %s", async (path, serverName) => {
    const res = await initialize(path);
    expect(res.status).toBe(200);
    // The initialize result rides an SSE frame; the serverInfo name is
    // the roster's identity and must match the route exactly.
    expect(await res.text()).toContain(`"name":"${serverName}"`);
  });

  it("refuses an unknown route with 404 instead of a default roster", async () => {
    // The 2026-08-05 incident regression pin: a bridge that does not
    // recognize a route must say so at connect time — silently serving
    // the full roster there once handed an agent every management tool
    // except the send tool its attachment existed for.
    const res = await initialize("/no-such-roster");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("unknown MCP route: /no-such-roster");
  });
});

// HTTP transport hardening, OAuth discovery and the stateless contract.
//
// Boots the real Streamable HTTP transport on an ephemeral port it reports
// through `onListening` (never a probed one, stigmer#1469) and exercises the
// HTTP surface: the /health and /ready probes, RFC 9728 protected resource
// metadata (GET + CORS preflight), the WWW-Authenticate challenge on
// token-less requests, and the stateless contract: any request is served
// without a session, GET answers 405, and a body that is not JSON is answered
// 400 while the server keeps serving. Token validation is never performed
// here — presence is the only check (Go parity: internal/server/http.go).

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Config } from "../config";
import { configureLogger } from "../logger";
import { httpHandler, serveHttp } from "../server";

configureLogger({ level: "error", format: "text" });

let port: number;
let controller: AbortController;
let serving: Promise<void>;

beforeAll(async () => {
  const cfg: Config = {
    stigmerServerAddress: "localhost:7234",
    apiKey: "",
    transport: "http",
    roster: "full",
    // Ephemeral: the listener reports the port it bound (stigmer#1469).
    httpPort: "0",
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
  let reportPort!: (bound: number) => void;
  const listening = new Promise<number>((resolve) => {
    reportPort = resolve;
  });
  serving = serveHttp(
    httpHandler({ serverAddress: cfg.stigmerServerAddress, apiKey: "" }, cfg),
    cfg,
    controller.signal,
    { onListening: reportPort },
  );
  // Listening, or the bind's failure: whichever comes first.
  port = await Promise.race([listening, serving.then(() => Promise.reject(new Error("serveHttp ended before listening")))]);
});

afterAll(async () => {
  controller.abort();
  await serving;
});

const base = () => `http://127.0.0.1:${port}`;

/**
 * Every refusal must be a JSON-RPC error object with Content-Type
 * application/json (oss#316 — strict MCP clients parse the body; text/plain
 * surfaced as opaque content-type errors). Returns the error for
 * code-specific assertions.
 */
async function expectJsonRpcError(res: Response): Promise<{ code: number; message: string }> {
  expect(res.headers.get("content-type")).toBe("application/json");
  const body = (await res.json()) as { jsonrpc: string; error: { code: number; message: string }; id: null };
  expect(body.jsonrpc).toBe("2.0");
  expect(body.id).toBeNull();
  expect(typeof body.error.code).toBe("number");
  return body.error;
}

describe("HTTP transport hardening + OAuth discovery", () => {
  it("answers the /health probe without auth", async () => {
    const res = await fetch(`${base()}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("reports unready on /ready when the backend hop is down (no auth required)", async () => {
    // The suite's backend address points at nothing — exactly the failure
    // class /ready exists to expose while /health stays green (oss#316).
    const res = await fetch(`${base()}/ready`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; reason?: string };
    expect(body.status).toBe("unready");
    expect(body.reason).toContain("backend health check failed");
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

  it("challenges token-less requests with WWW-Authenticate and a JSON-RPC body", async () => {
    const res = await fetch(`${base()}/`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('realm="stigmer"');
    expect(challenge).toContain(
      'resource_metadata="https://mcp.stigmer.ai/.well-known/oauth-protected-resource"',
    );
    expect(challenge).toContain('scope="read write"');
    const error = await expectJsonRpcError(res);
    expect(error.code).toBe(-32000);
    expect(error.message).toContain("missing or malformed Authorization");
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
    await expectJsonRpcError(res);
  });

  it("serves a bare tools/list with no session, as plain JSON", async () => {
    const res = await mcpPost("/", { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools).toHaveLength(11);
  });

  it("ignores a session id a client still holds from a stateful server", async () => {
    // Clients that connected before the move to stateless replay their old
    // Mcp-Session-Id; it must be served, never answered 404.
    const res = await mcpPost("/channels", { jsonrpc: "2.0", id: 1, method: "tools/list" }, { "mcp-session-id": "from-a-stateful-server" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((t) => t.name)).toEqual(["send_channel_message"]);
  });

  it.each(["GET", "DELETE"])("answers %s 405: no stream to open, no session to end", async (method) => {
    const res = await fetch(`${base()}/`, { method, headers: { authorization: "Bearer test-token" } });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    const error = await expectJsonRpcError(res);
    expect(error.code).toBe(-32000);
  });

  it("answers a body that is not JSON 400 and keeps serving", async () => {
    // The parse failure must be an answer, never a throw: a rejection in a
    // request listener exits Node.
    const res = await fetch(`${base()}/`, {
      method: "POST",
      headers: mcpHeaders(),
      body: "{not json",
      signal: AbortSignal.timeout(5_000),
    });
    expect(res.status).toBe(400);
    const error = await expectJsonRpcError(res);
    expect(error.code).toBe(-32700);
    expect((await fetch(`${base()}/health`)).status).toBe(200);
  });
});

/** The headers a conformant client sends on an MCP POST. */
function mcpHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: "Bearer test-token",
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...extra,
  };
}

/** POST one JSON-RPC message to `path`; returns the raw Response. */
function mcpPost(path: string, message: unknown, extra: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base()}${path}`, { method: "POST", headers: mcpHeaders(extra), body: JSON.stringify(message) });
}

/** POST a real MCP initialize to `path`; returns the raw Response. */
function initialize(path: string): Promise<Response> {
  return mcpPost(path, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "http-integration", version: "test" },
    },
  });
}

describe("HTTP route dispatch (the closed route table)", () => {
  it.each([
    ["/", "mcp-server-stigmer"],
    ["/channels", "mcp-server-stigmer-channels"],
    ["/conversation", "mcp-server-stigmer-conversation"],
    ["/memory", "mcp-server-stigmer-memory"],
  ])("serves the %s roster as %s", async (path, serverName) => {
    const res = await initialize(path);
    expect(res.status).toBe(200);
    // The serverInfo name is the roster's identity and must match the
    // route exactly; the reply is plain JSON and opens no session.
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const body = (await res.json()) as { result: { serverInfo: { name: string } } };
    expect(body.result.serverInfo.name).toBe(serverName);
  });

  it("refuses an unknown route with 404 instead of a default roster", async () => {
    // The 2026-08-05 incident regression pin: a bridge that does not
    // recognize a route must say so at connect time — silently serving
    // the full roster there once handed an agent every management tool
    // except the send tool its attachment existed for.
    const res = await initialize("/no-such-roster");
    expect(res.status).toBe(404);
    const error = await expectJsonRpcError(res);
    expect(error.code).toBe(-32000);
    expect(error.message).toContain("unknown MCP route: /no-such-roster");
  });
});

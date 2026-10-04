// The mountable handler, as a host mounts it: on the host's own node:http
// server, with the host's door check.
//
// Pins what a host relies on: the door-check verdicts map to the wire shapes
// OAuth clients act on (refused is 401 with the challenge, unavailable and a
// throwing check are 503, a token-less request never reaches the check), the
// trusted-proxy mode ignores the Authorization header entirely, the
// body cap answers 413 whether the size is declared or streamed, and no
// failure escapes the handler's promise (a transport fault before or after its
// headers, a failing close, a client gone mid-upload or mid-answer): a
// rejection inside a node:http listener exits the host process.

import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OAuthConfig } from "../config";
import { createMcpHttpHandler, createRoutedHandler, type BearerVerdict, type McpHttpHandler } from "../http-handler";
import { configureLogger } from "../logger";

configureLogger({ level: "error", format: "text" });

const OAUTH: OAuthConfig = {
  enabled: true,
  resource: "https://mcp.example.com",
  authorizationServers: ["https://issuer.example.com/"],
  scopesSupported: [],
};

const TOOLS_LIST = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

let host: Server | undefined;
const settled: Array<Promise<void>> = [];

afterEach(async () => {
  await new Promise<void>((resolve) => (host ? host.close(() => resolve()) : resolve()));
  host = undefined;
  settled.length = 0;
});

/** Mount `handler` on a fresh host server; returns its base URL. */
async function mount(handler: McpHttpHandler): Promise<string> {
  host = createServer((req, res) => {
    settled.push(handler(req, res));
  });
  await new Promise<void>((resolve) => host!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(host.address() as AddressInfo).port}`;
}

function headers(token?: string): Record<string, string> {
  return {
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
}

function echoServer(): McpServer {
  const server = new McpServer({ name: "echo", version: "test" });
  server.registerTool("whoami", { description: "echo" }, (extra) => ({
    content: [{ type: "text", text: extra.authInfo?.token ?? "<none>" }],
  }));
  return server;
}

/**
 * An echo server whose transport fails while handling the request: before
 * any byte is written, or after the headers are out.
 */
function withTransportFailure(afterHeaders: boolean): McpServer {
  const server = echoServer();
  const connect = server.connect.bind(server);
  server.connect = async (transport) => {
    const http = transport as StreamableHTTPServerTransport;
    http.handleRequest = async (_req, res) => {
      if (afterHeaders) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.write("{");
      }
      throw new Error("transport failed");
    };
    return connect(transport);
  };
  return server;
}

function withCheck(verdict: (token: string) => Promise<BearerVerdict>): McpHttpHandler {
  return createRoutedHandler(() => echoServer(), { authRequired: true, oauth: OAUTH, authenticate: verdict });
}

describe("the host's door check", () => {
  it("serves an accepted bearer, and the tool sees that bearer", async () => {
    const check = vi.fn(async () => "accepted" as const);
    const base = await mount(withCheck(check));
    const res = await fetch(`${base}/`, {
      method: "POST",
      headers: headers("tok-a"),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {} } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { content: Array<{ text: string }> } };
    expect(body.result.content[0]?.text).toBe("tok-a");
    expect(check).toHaveBeenCalledWith("tok-a");
  });

  it("answers a refused bearer 401 with the OAuth challenge, so the client refreshes", async () => {
    const base = await mount(withCheck(async () => "refused"));
    const res = await fetch(`${base}/`, { method: "POST", headers: headers("expired"), body: TOOLS_LIST });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer realm="stigmer", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"',
    );
    expect(await res.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32000, message: "invalid or expired bearer token" },
      id: null,
    });
  });

  it("answers 503 when the host cannot decide, never 401", async () => {
    const base = await mount(withCheck(async () => "unavailable"));
    const res = await fetch(`${base}/`, { method: "POST", headers: headers("t"), body: TOOLS_LIST });
    expect(res.status).toBe(503);
    expect(res.headers.get("www-authenticate")).toBeNull();
  });

  it("reads a throwing check as unavailable", async () => {
    const base = await mount(
      withCheck(async () => {
        throw new Error("key set unreachable");
      }),
    );
    const res = await fetch(`${base}/`, { method: "POST", headers: headers("t"), body: TOOLS_LIST });
    expect(res.status).toBe(503);
  });

  it("ignores the Authorization header in trusted-proxy mode, so the startup key stays the credential", async () => {
    // With auth off every tool call runs on the operator's startup key; a
    // header a client or proxy adds must never replace it, and the check
    // is never asked.
    const check = vi.fn(async () => "refused" as const);
    const base = await mount(
      createRoutedHandler(() => echoServer(), {
        authRequired: false,
        oauth: { ...OAUTH, enabled: false },
        authenticate: check,
      }),
    );
    const res = await fetch(`${base}/`, {
      method: "POST",
      headers: headers("proxy-token"),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {} } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { content: Array<{ text: string }> } };
    expect(body.result.content[0]?.text).toBe("<none>");
    expect(check).not.toHaveBeenCalled();
  });

  it("challenges a token-less request without consulting the check", async () => {
    const check = vi.fn(async () => "accepted" as const);
    const base = await mount(withCheck(check));
    const res = await fetch(`${base}/`, { method: "POST", headers: headers(), body: TOOLS_LIST });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("resource_metadata=");
    expect(check).not.toHaveBeenCalled();
  });
});

describe("the body cap", () => {
  const capped = () =>
    createRoutedHandler(() => echoServer(), { authRequired: false, oauth: { ...OAUTH, enabled: false }, maxBodyBytes: 64 });

  it("answers a declared oversize body 413", async () => {
    const base = await mount(capped());
    const res = await fetch(`${base}/`, { method: "POST", headers: headers(), body: "x".repeat(65) });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: number } }).error.code).toBe(-32000);
  });

  it("answers a streamed oversize body 413 without buffering it", async () => {
    const base = await mount(capped());
    const chunks = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 4; i++) controller.enqueue(new TextEncoder().encode("y".repeat(32)));
        controller.close();
      },
    });
    const res = await fetch(`${base}/`, { method: "POST", headers: headers(), body: chunks, duplex: "half" } as RequestInit);
    expect(res.status).toBe(413);
  });

  it("serves a body under the cap", async () => {
    const base = await mount(capped());
    const res = await fetch(`${base}/`, { method: "POST", headers: headers(), body: TOOLS_LIST });
    expect(res.status).toBe(200);
  });
});

describe("containment", () => {
  it("answers a failure 500 and the handler's promise still resolves", async () => {
    const handler = createRoutedHandler(
      () => {
        throw new Error("roster construction failed");
      },
      { authRequired: false, oauth: { ...OAUTH, enabled: false } },
    );
    const base = await mount(handler);
    const res = await fetch(`${base}/`, { method: "POST", headers: headers(), body: TOOLS_LIST });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: number } }).error.code).toBe(-32603);
    await expect(Promise.all(settled)).resolves.toBeDefined();
  });

  it("answers 500 when the transport fails before answering", async () => {
    const handler = createRoutedHandler(() => withTransportFailure(false), { authRequired: false, oauth: { ...OAUTH, enabled: false } });
    const base = await mount(handler);
    const res = await fetch(`${base}/`, { method: "POST", headers: headers(), body: TOOLS_LIST });
    expect(res.status).toBe(500);
    await expect(Promise.all(settled)).resolves.toBeDefined();
  });

  it("cuts the response when the transport fails after its headers are out", async () => {
    const handler = createRoutedHandler(() => withTransportFailure(true), { authRequired: false, oauth: { ...OAUTH, enabled: false } });
    const base = await mount(handler);
    await expect(
      fetch(`${base}/`, { method: "POST", headers: headers(), body: TOOLS_LIST }).then((r) => r.text()),
    ).rejects.toThrow();
    await expect(Promise.all(settled)).resolves.toBeDefined();
  });

  it("logs a failing server close instead of rejecting", async () => {
    const server = echoServer();
    server.close = async () => {
      throw new Error("close failed");
    };
    const base = await mount(createRoutedHandler(() => server, { authRequired: false, oauth: { ...OAUTH, enabled: false } }));
    const res = await fetch(`${base}/`, { method: "POST", headers: headers(), body: TOOLS_LIST });
    expect(res.status).toBe(200);
    await expect(Promise.all(settled)).resolves.toBeDefined();
  });

  it("settles when the client drops mid-upload", async () => {
    const base = await mount(createRoutedHandler(() => echoServer(), { authRequired: false, oauth: { ...OAUTH, enabled: false } }));
    const url = new URL(base);
    const req = request({ host: url.hostname, port: url.port, method: "POST", path: "/", headers: headers() });
    req.on("error", () => undefined);
    req.write('{"jsonrpc":');
    await vi.waitFor(() => expect(settled).toHaveLength(1));
    req.destroy();
    await expect(Promise.race([settled[0], new Promise((r) => setTimeout(() => r("hung"), 2_000))])).resolves.toBeUndefined();
  });

  it("settles when the client disconnects before its answer", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = new McpServer({ name: "slow", version: "test" });
    slow.registerTool("wait", { description: "blocks until released" }, async () => {
      await gate;
      return { content: [{ type: "text", text: "late" }] };
    });
    const base = await mount(createRoutedHandler(() => slow, { authRequired: false, oauth: { ...OAUTH, enabled: false } }));
    const aborted = new AbortController();
    const pending = fetch(`${base}/`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wait", arguments: {} } }),
      signal: aborted.signal,
    }).catch(() => undefined);
    await vi.waitFor(() => expect(settled).toHaveLength(1));
    aborted.abort();
    await pending;
    await expect(Promise.race([settled[0], new Promise((r) => setTimeout(() => r("hung"), 2_000))])).resolves.toBeUndefined();
    release();
  });
});

describe("createMcpHttpHandler", () => {
  it("serves the production route table and refuses unknown routes", async () => {
    const base = await mount(
      createMcpHttpHandler({
        target: { serverAddress: "127.0.0.1:1", apiKey: "" },
        authRequired: true,
        oauth: { ...OAUTH, enabled: false },
      }),
    );
    const memory = await fetch(`${base}/memory`, { method: "POST", headers: headers("t"), body: TOOLS_LIST });
    expect(memory.status).toBe(200);
    const tools = ((await memory.json()) as { result: { tools: Array<{ name: string }> } }).result.tools;
    expect(tools.map((t) => t.name)).toEqual(["remember"]);

    const unknown = await fetch(`${base}/mcp`, { method: "POST", headers: headers("t"), body: TOOLS_LIST });
    expect(unknown.status).toBe(404);
  });
});

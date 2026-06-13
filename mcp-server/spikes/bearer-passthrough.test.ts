// Spike A — non-validating Bearer passthrough over Streamable HTTP.
//
// Question this proves: can the TS MCP server reproduce the Go server's HTTP
// auth model — extract `Authorization: Bearer <token>` WITHOUT validating it,
// surface it to tool handlers, and build a per-request client from it — using a
// single stateless McpServer shared across all requests?
//
// Findings: _projects/.../design-decisions/008-... and the session checkpoint.
// Retained as a T02 seed for the full HTTP hardening work.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer as netCreateServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { loadConfigFromEnv, type Config } from "../src/config";
import { serveHttp } from "../src/server";
import { textResult } from "../src/domains/toolresult";

/** Build a one-tool server whose tool echoes the resolved per-request token. */
function buildEchoServer(): McpServer {
  const server = new McpServer({ name: "spike-a", version: "test" });
  server.registerTool(
    "whoami",
    { description: "Echo the Bearer token the handler received via authInfo." },
    (extra) => textResult(extra.authInfo?.token ?? "<none>"),
  );
  return server;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = netCreateServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("HTTP transport did not become ready");
}

/** Connect a client carrying `token` (or none) and return its session. */
async function connectClient(port: number, token?: string): Promise<Client> {
  const client = new Client({ name: "spike-a-client", version: "test" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  await client.connect(transport);
  return client;
}

async function callWhoami(client: Client): Promise<string> {
  const result = (await client.callTool({ name: "whoami" })) as {
    content: Array<{ type: string; text?: string }>;
  };
  return result.content[0]?.text ?? "";
}

describe("Spike A: non-validating Bearer passthrough", () => {
  let shutdown: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await shutdown?.();
    shutdown = undefined;
  });

  async function start(cfgOverrides: Partial<Config>): Promise<number> {
    const port = await getFreePort();
    const cfg: Config = { ...loadConfigFromEnv(), httpPort: String(port), ...cfgOverrides };
    const ac = new AbortController();
    const serving = serveHttp(() => buildEchoServer(), cfg, ac.signal);
    shutdown = async () => {
      ac.abort();
      await serving;
    };
    await waitForHealth(port);
    return port;
  }

  it("forwards the per-request Bearer token to the handler as authInfo, unvalidated", async () => {
    const port = await start({ httpAuthEnabled: true });

    // Two different tokens against the SAME stateless server prove there is no
    // cross-request bleed: each call sees only its own credential.
    const alice = await connectClient(port, "sk_alice_arbitrary_unvalidated");
    const bob = await connectClient(port, "sk_bob_arbitrary_unvalidated");

    expect(await callWhoami(alice)).toBe("sk_alice_arbitrary_unvalidated");
    expect(await callWhoami(bob)).toBe("sk_bob_arbitrary_unvalidated");

    await alice.close();
    await bob.close();
  });

  it("rejects requests with no Bearer header (401) when auth is enabled", async () => {
    const port = await start({ httpAuthEnabled: true });
    await expect(connectClient(port)).rejects.toThrow();
  });

  it("allows unauthenticated requests when auth is disabled (trusted-proxy mode)", async () => {
    const port = await start({ httpAuthEnabled: false });
    const client = await connectClient(port);
    expect(await callWhoami(client)).toBe("<none>");
    await client.close();
  });
});

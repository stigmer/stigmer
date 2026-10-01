// Spike A — non-validating Bearer passthrough over Streamable HTTP.
//
// Question this proves: can the TS MCP server reproduce the Go server's HTTP
// auth model — extract `Authorization: Bearer <token>` WITHOUT validating it,
// surface it to tool handlers, and build a per-request client from it — using a
// single stateless McpServer shared across all requests?
//
// Finding: yes, and this file is the proof. Retained as the seed for the full
// HTTP hardening work; the production transport in mcp-server/src grew from it.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";

import { loadConfigFromEnv, type Config } from "../config";
import { serveHttp } from "../server";
import { textResult } from "../domains/toolresult";

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

  // Binds an ephemeral port and resolves the one the listener reports, never a
  // probed one (stigmer#1469).
  async function start(cfgOverrides: Partial<Config>): Promise<number> {
    const cfg: Config = { ...loadConfigFromEnv(), httpPort: "0", ...cfgOverrides };
    const ac = new AbortController();
    let reportPort!: (port: number) => void;
    const listening = new Promise<number>((resolve) => {
      reportPort = resolve;
    });
    const serving = serveHttp(() => buildEchoServer(), cfg, ac.signal, { onListening: reportPort });
    shutdown = async () => {
      ac.abort();
      await serving;
    };
    return Promise.race([listening, serving.then(() => Promise.reject(new Error("serveHttp ended before listening")))]);
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

/**
 * Pins the Claude turn's MCP bridge (`mcp-bridge.ts`) against real servers:
 * a stdio server (a small script on the MCP SDK's own server, started by
 * the bridge) and a streamable-HTTP server in this process.
 *
 * What it pins, and why:
 *  - the host connects every server itself, so a stdio server is the host's
 *    child, never the engine's: the server reports its own parent, which is
 *    this test process, the one that called the bridge;
 *  - an HTTP server's declared headers reach it from the host (they never
 *    sit on the engine's command line);
 *  - the engine sees each tool as `mcp__<slug>__<tool>`, every page of a
 *    server's listing read, each schema loosened where a pattern cannot
 *    compile under the unicode flag, so one vendor pattern never leaves a
 *    tool uncallable;
 *  - the agents' per-server and per-tool lists decide what is listed (the
 *    turn's agents answer as one predicate, `agents.ts`), and a call to a
 *    tool nobody may call is refused before it reaches its server;
 *    the platform's own servers are outside every list and outside the
 *    approval default's listing;
 *  - calls are forwarded unchanged and their answers returned, a server's
 *    failure becoming an error result the model reads;
 *  - every connection is closed when the turn ends, and when connecting
 *    fails half way.
 */

import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ResolvedMcpServer } from "../../../shared/mcp-resolver.js";
import { ToolScope } from "../../../shared/tool-lists.js";
import { connectBridge, mcpToolName, type McpBridge } from "../mcp-bridge.js";
import type { ServedServer } from "../loopback-mcp.js";
import { connectServed } from "../__test-utils__/served-client.js";

const SDK_DIST = fileURLToPath(new URL("../../../../node_modules/@modelcontextprotocol/sdk/dist/esm/", import.meta.url));

/**
 * The stdio server: six tools over two pages. In `endless` mode its first
 * listing (the connection library's own) ends, and every listing after it
 * names one more page forever.
 */
function stdioServerSource(): string {
  const sdk = (path: string): string => JSON.stringify(pathToFileURL(join(SDK_DIST, path)).href);
  return `
import { writeFileSync } from "node:fs";
import { Server } from ${sdk("server/index.js")};
import { StdioServerTransport } from ${sdk("server/stdio.js")};
import { CallToolRequestSchema, ListToolsRequestSchema } from ${sdk("types.js")};

const object = (properties) => ({ type: "object", properties });
const TOOLS = [
  { name: "whoami", description: "Who runs me.", inputSchema: object({}) },
  { name: "echo", description: "Echo.", inputSchema: object({ text: { type: "string" } }) },
  {
    name: "patterned",
    description: "A vendor pattern that only compiles without the unicode flag.",
    inputSchema: object({ url: { type: "string", pattern: "^https\\\\:\\\\/\\\\/" }, id: { type: "string", pattern: "^[a-z]+$" } }),
  },
  { name: "rm_all", description: "Destructive.", inputSchema: object({}), annotations: { destructiveHint: true } },
  { name: "boom", description: "Fails.", inputSchema: object({}) },
  { name: "hidden", description: "Out of every list.", inputSchema: object({}) },
];

const server = new Server({ name: "stdio-test", version: "1.0.0" }, { capabilities: { tools: {} } });
let listings = 0;
server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  const cursor = request.params?.cursor;
  if (cursor === undefined) listings += 1;
  if (process.env.BRIDGE_TEST_MODE === "endless" && listings >= 2) return { tools: [], nextCursor: "again-" + Math.random() };
  return cursor === undefined ? { tools: TOOLS.slice(0, 3), nextCursor: "page-2" } : { tools: TOOLS.slice(3) };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "whoami":
      return { content: [{ type: "text", text: JSON.stringify({ pid: process.pid, ppid: process.ppid, declared: process.env.DECLARED_VALUE ?? null }) }] };
    case "echo":
      return { content: [{ type: "text", text: "echo:" + request.params.arguments?.text }] };
    case "boom":
      throw new Error("the tool blew up");
    default:
      return { content: [{ type: "text", text: "called " + request.params.name }] };
  }
});
if (process.env.PID_FILE) writeFileSync(process.env.PID_FILE, String(process.pid));
await server.connect(new StdioServerTransport());
`;
}

// ─── The HTTP server, in this process ───

const HTTP_TOOLS: Tool[] = [
  { name: "add", description: "Adds.", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } } },
  { name: "wipe", description: "Destructive.", inputSchema: { type: "object", properties: {} }, annotations: { destructiveHint: true } },
  { name: "secret", description: "Denied by the agent's list.", inputSchema: { type: "object", properties: {} } },
];

class HttpMcp {
  readonly authorizations: { path: string; authorization: string | undefined }[] = [];
  /** Event streams the client holds open, by session. */
  openStreams = 0;
  streamsOpened = 0;
  url = "";
  private server: HttpServer | undefined;
  private readonly sessions = new Map<string, StreamableHTTPServerTransport>();

  async start(): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    for (const transport of this.sessions.values()) await transport.close();
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.authorizations.push({ path: req.url ?? "", authorization: req.headers.authorization });
    const id = req.headers["mcp-session-id"];
    let transport = typeof id === "string" ? this.sessions.get(id) : undefined;
    if (transport === undefined) {
      const created: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => void this.sessions.set(sid, created),
      });
      const server = new Server({ name: "http-test", version: "1.0.0" }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: HTTP_TOOLS }));
      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const args = request.params.arguments as { a?: number; b?: number } | undefined;
        return { content: [{ type: "text", text: request.params.name === "add" ? String((args?.a ?? 0) + (args?.b ?? 0)) : `called ${request.params.name}` }] };
      });
      await server.connect(created);
      transport = created;
    }
    if (req.method === "GET") {
      this.openStreams += 1;
      this.streamsOpened += 1;
      res.on("close", () => {
        this.openStreams -= 1;
      });
    }
    await transport.handleRequest(req, res);
  }
}

const http = new HttpMcp();
let dir: string;
let script: string;
const bridges: McpBridge[] = [];

beforeAll(async () => {
  await http.start();
  dir = await mkdtemp(join(tmpdir(), "claude-mcp-bridge-"));
  script = join(dir, "stdio-server.mjs");
  await writeFile(script, stdioServerSource());
});
afterAll(async () => {
  await http.stop();
  await rm(dir, { recursive: true, force: true });
});
afterEach(async () => {
  for (const served of servedClients.splice(0)) await served.close();
  for (const bridge of bridges.splice(0)) await bridge.close();
});

function stdioServer(slug: string, env: Record<string, string> = {}): ResolvedMcpServer {
  return { slug, connectionType: "stdio", command: process.execPath, args: [script], env, home: { kind: "agent", agentId: "agt-1", subagent: null, server: slug } };
}

function httpServer(slug: string, headers: Record<string, string>, platform = false): ResolvedMcpServer {
  return {
    slug,
    connectionType: "http",
    url: `${http.url}/mcp/${slug}`,
    headers,
    home: platform ? { kind: "platform" } : { kind: "plugin", pluginId: "plg-1", plugin: "web-plugin", server: slug },
  };
}

/** The agent's lists: a per-tool allow-list for the stdio server, the whole HTTP server less one tool. */
const SCOPE = ToolScope.of("agent", {
  tools: ["mcp__local__whoami", "mcp__local__echo", "mcp__local__patterned", "mcp__local__rm_all", "mcp__local__boom", "mcp__web"],
  disallowedTools: ["mcp__web__secret"],
});

/** A scope as the bridge's predicate. */
function inScope(scope: ToolScope): (slug: string, tool: string) => boolean {
  return (slug, tool) => scope.allowsMcpTool(slug, tool);
}

/** The engine's client on one served server, over the host's real endpoint; closed with the test's other clients. */
async function engineClient(server: ServedServer): Promise<Client> {
  const served = await connectServed([server]);
  servedClients.push(served);
  return served.client;
}

const servedClients: { close(): Promise<void> }[] = [];

function textOf(result: CallToolResult): string {
  return result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("connectBridge over a real stdio server and a real HTTP server", () => {
  it("lists in-scope tools under the engine's names, forwards calls, and closes every connection", async () => {
    const bridge = await connectBridge(
      [stdioServer("local", { DECLARED_VALUE: "declared" }), httpServer("web", { Authorization: "Bearer web-login" }), httpServer("chan", { Authorization: "Bearer platform-login" }, true)],
      inScope(SCOPE),
      new Set(["chan"]),
    );

    expect([...bridge.servers.keys()]).toEqual(["local", "web", "chan"]);
    expect([...bridge.offered].sort()).toEqual(
      [
        "mcp__local__whoami",
        "mcp__local__echo",
        "mcp__local__patterned",
        "mcp__local__rm_all",
        "mcp__local__boom",
        "mcp__web__add",
        "mcp__web__wipe",
        "mcp__chan__add",
        "mcp__chan__wipe",
        "mcp__chan__secret",
      ].sort(),
    );
    expect(bridge.serverOf("mcp__local__echo")).toEqual({ slug: "local", tool: "echo" });
    expect(bridge.serverOf(mcpToolName("chan", "secret")), "the platform's server is outside every list").toEqual({ slug: "chan", tool: "secret" });
    expect(bridge.serverOf("mcp__local__hidden"), "out of the per-tool list").toBeUndefined();
    expect(bridge.serverOf("mcp__web__secret"), "denied by the per-server list").toBeUndefined();
    expect(bridge.listing).toEqual({
      listed: [
        { server: "local", tools: ["whoami", "echo", "patterned", "rm_all", "boom"] },
        { server: "web", tools: ["add", "wipe"] },
      ],
      destructive: [
        { server: "local", tool: "rm_all" },
        { server: "web", tool: "wipe" },
      ],
      unlisted: [],
    });

    const local = await engineClient(bridge.servers.get("local")!);
    const web = await engineClient(bridge.servers.get("web")!);
    let childPid: number;
    try {
      const listed = await local.listTools();
      expect(listed.tools.map((t) => t.name), "every page, in scope").toEqual(["whoami", "echo", "patterned", "rm_all", "boom"]);
      const patterned = listed.tools.find((t) => t.name === "patterned")!;
      const properties = patterned.inputSchema.properties as Record<string, Record<string, unknown>>;
      expect(properties.url, "the pattern that cannot compile under the unicode flag is dropped").toEqual({ type: "string" });
      expect(properties.id, "a pattern that compiles is kept").toEqual({ type: "string", pattern: "^[a-z]+$" });

      const who = JSON.parse(textOf((await local.callTool({ name: "whoami", arguments: {} })) as CallToolResult)) as { pid: number; ppid: number; declared: string | null };
      expect(who.ppid, "the server is the host's own child: this process, which connected it").toBe(process.pid);
      expect(who.declared, "its declared environment reached it").toBe("declared");
      childPid = who.pid;
      expect(isAlive(childPid)).toBe(true);

      expect(textOf((await local.callTool({ name: "echo", arguments: { text: "hello" } })) as CallToolResult)).toBe("echo:hello");
      const failed = (await local.callTool({ name: "boom", arguments: {} })) as CallToolResult;
      expect(failed.isError).toBe(true);
      expect(textOf(failed)).toMatch(/^MCP server 'local' failed the call: .*the tool blew up/);
      const hidden = (await local.callTool({ name: "hidden", arguments: {} })) as CallToolResult;
      expect(hidden.isError, "a tool the server has but the lists leave out").toBe(true);
      expect(textOf(hidden)).toBe("Tool 'hidden' is not available on server 'local'.");

      expect((await web.listTools()).tools.map((t) => t.name)).toEqual(["add", "wipe"]);
      expect(textOf((await web.callTool({ name: "add", arguments: { a: 2, b: 3 } })) as CallToolResult)).toBe("5");
      const denied = (await web.callTool({ name: "secret", arguments: {} })) as CallToolResult;
      expect(denied.isError).toBe(true);
      expect(textOf(denied)).toBe("Tool 'secret' is not available on server 'web'.");
    } finally {
      await local.close();
      await web.close();
    }

    const byPath = (path: string): (string | undefined)[] => [...new Set(http.authorizations.filter((a) => a.path === path).map((a) => a.authorization))];
    expect(byPath("/mcp/web"), "the server's declared header, from the host").toEqual(["Bearer web-login"]);
    expect(byPath("/mcp/chan")).toEqual(["Bearer platform-login"]);
    expect(http.streamsOpened, "the HTTP clients held their event streams open").toBeGreaterThan(0);

    await bridge.close();
    await until(() => !isAlive(childPid), "the stdio server exits");
    await until(() => http.openStreams === 0, "every HTTP event stream is closed");
  });

  it("closes what it connected when connecting fails half way", async () => {
    const pidFile = join(dir, "endless.pid");
    await expect(
      connectBridge([stdioServer("endless", { BRIDGE_TEST_MODE: "endless", PID_FILE: pidFile })], () => true, new Set()),
    ).rejects.toThrow("MCP server 'endless' answered more than 100 pages of tools");
    const pid = Number(await readFile(pidFile, "utf8"));
    await until(() => !isAlive(pid), "the half-connected server exits");
  });

  it("raises a server the connections hold no client for", async () => {
    const missing = vi.spyOn(MultiServerMCPClient.prototype, "getClient").mockResolvedValue(undefined);
    try {
      await expect(connectBridge([stdioServer("local")], () => true, new Set())).rejects.toThrow("MCP server 'local' did not connect");
    } finally {
      missing.mockRestore();
    }
  });

  it("raises a server that does not connect", async () => {
    const dead: ResolvedMcpServer = { ...stdioServer("dead"), args: ["-e", "process.exit(3)"] };
    await expect(connectBridge([dead], () => true, new Set())).rejects.toThrow();
  });

  it("connects nothing for a turn with no servers, or none it can reach", async () => {
    const commandless: ResolvedMcpServer = { slug: "nothing", connectionType: "stdio", home: { kind: "platform" } };
    for (const servers of [[], [commandless]]) {
      const bridge = await connectBridge(servers, inScope(SCOPE), new Set());
      bridges.push(bridge);
      expect(bridge.servers.size).toBe(0);
      expect(bridge.offered.size).toBe(0);
      expect(bridge.serverOf("mcp__nothing__x")).toBeUndefined();
      expect(bridge.listing).toEqual({ listed: [], destructive: [], unlisted: [] });
      await expect(bridge.close()).resolves.toBeUndefined();
    }
  });
});

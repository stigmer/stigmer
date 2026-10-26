/**
 * The tools the agent host serves the Claude engine (its shell and every
 * bridged MCP server), as MCP over HTTP on the loopback interface: one
 * endpoint per invocation, one path per server, one bearer token.
 *
 * Why HTTP and not the SDK's in-process channel: a call the gate pauses
 * (`defer`) is re-run by the engine when the session resumes in a new
 * process, and the engine looks the tool up the moment it starts, before
 * the SDK has registered an in-process server, so such a call never
 * resumes (`tool_deferred_unavailable`). A server it dials over HTTP is in
 * its pool by then, and the call runs (both measured on SDK 0.3.310). So
 * the host keeps every tool in its own process, as before, and only the
 * channel the engine reaches them by changes: no tool is the engine's child.
 *
 * The token rides the engine's MCP configuration, which a process of the
 * same user can read (the exposure stigmer#2582 tracks for the host
 * itself). So the token is not what authorizes a call: every `tools/call`
 * is admitted by the gate first ({@link CallAdmission}, `gate.ts`), which
 * lets a call run only under its own allow verdict, once, with exactly the
 * arguments that verdict judged. A request that holds the token gains
 * nothing the gate did not already allow the engine.
 *
 * Each call carries the engine's own id for it
 * (`_meta["claudecode/toolUseId"]`, measured on SDK 0.3.310 over this
 * transport too): the id the gate decided it under and the transcript keys
 * its row by. A tool's JSON schema reaches the engine as the tool wrote it.
 */

import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { McpHttpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";

/** The `_meta` key the engine puts its tool-use id under. */
const TOOL_USE_ID_META = "claudecode/toolUseId";

/** The path prefix each server is served under: `/mcp/<name>`. */
const PATH_PREFIX = "/mcp/";

/** One call as a served server's handler sees it. */
export interface ServedCall {
  /** The server's name, the engine's `mcp__<name>__` segment. */
  readonly server: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  /** The engine's id for the call; "" when the engine sent none. */
  readonly toolUseId: string;
}

/** One server the host serves: its name, its tools (read on every listing) and its calls. */
export interface ServedServer {
  readonly name: string;
  readonly tools: () => readonly Tool[];
  readonly call: (call: ServedCall) => Promise<CallToolResult>;
}

/** Whether a call may run: undefined lets it, a string is the refusal the engine reads (the header). */
export type CallAdmission = (call: ServedCall) => string | undefined;

/** The running endpoint (the header). */
export interface LoopbackMcp {
  /** The engine's configuration for each server, by name. */
  readonly configs: Readonly<Record<string, McpHttpServerConfig>>;
  close(): Promise<void>;
}

/** A call's answer as text, marked an error when it is one. */
export function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

/** Serve `servers` on the loopback interface, each call admitted by `admit` (the header). */
export async function startLoopbackMcp(servers: readonly ServedServer[], admit: CallAdmission): Promise<LoopbackMcp> {
  const byName = new Map(servers.map((server) => [server.name, server]));
  const token = randomBytes(32).toString("base64url");
  const expected = Buffer.from(`Bearer ${token}`);
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const served = byName.get(serverNameOf(req.url));
    if (served === undefined) return reply(res, 404, "No such server.");
    const auth = Buffer.from(String(req.headers.authorization ?? ""));
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return reply(res, 401, "Unauthorized.");
    const id = req.headers["mcp-session-id"];
    let transport = typeof id === "string" ? sessions.get(id) : undefined;
    if (transport === undefined) {
      if (typeof id === "string") return reply(res, 404, "No such session.");
      transport = await openSession(served, admit, sessions);
    }
    await transport.handleRequest(req, res);
  };

  const http = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      console.warn(`[claude-mcp] the loopback endpoint failed a request: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) reply(res, 500, "The request failed.");
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", () => resolve());
  });
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}${PATH_PREFIX}`;
  const configs: Record<string, McpHttpServerConfig> = {};
  for (const server of servers) {
    configs[server.name] = { type: "http", url: `${base}${encodeURIComponent(server.name)}`, headers: { Authorization: `Bearer ${token}` } };
  }
  return { configs, close: () => closeAll(http, sessions) };
}

/** A new MCP session on `served`: its own protocol server over its own transport. */
async function openSession(served: ServedServer, admit: CallAdmission, sessions: Map<string, StreamableHTTPServerTransport>): Promise<StreamableHTTPServerTransport> {
  const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => void sessions.set(sessionId, transport),
  });
  transport.onclose = () => {
    if (transport.sessionId !== undefined) sessions.delete(transport.sessionId);
  };
  const server = new Server({ name: served.name, version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...served.tools()] }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const meta = request.params._meta as Record<string, unknown> | undefined;
    const call: ServedCall = {
      server: served.name,
      tool: request.params.name,
      args: (request.params.arguments ?? {}) as Record<string, unknown>,
      toolUseId: typeof meta?.[TOOL_USE_ID_META] === "string" ? meta[TOOL_USE_ID_META] : "",
    };
    const refused = admit(call);
    return refused === undefined ? served.call(call) : textResult(refused, true);
  });
  await server.connect(transport);
  return transport;
}

/** The server a request's path names; "" when it names none. */
function serverNameOf(url: string | undefined): string {
  const path = (url ?? "").split("?")[0] ?? "";
  if (!path.startsWith(PATH_PREFIX)) return "";
  try {
    return decodeURIComponent(path.slice(PATH_PREFIX.length));
  } catch {
    return "";
  }
}

function reply(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "content-type": "text/plain" }).end(text);
}

async function closeAll(http: HttpServer, sessions: Map<string, StreamableHTTPServerTransport>): Promise<void> {
  for (const transport of [...sessions.values()]) await transport.close().catch(() => undefined);
  sessions.clear();
  http.closeAllConnections();
  await new Promise<void>((resolve) => http.close(() => resolve()));
}

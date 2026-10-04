// Server construction, tool registration, and transport entry points.
//
// Mirrors Go internal/server (server.go + http.go) plus the lifecycle helpers
// from pkg/mcpserver/run.go. The server is stateless: every per-request value
// (the credential, and thus the gRPC client) is derived from the transport's
// auth context, so the registration is identical regardless of transport.
//
// The TS McpServer "assumes ownership" of a single transport, so stdio binds
// one server for the process while HTTP builds one per request from the route
// factory (http-handler.ts); the rosters are logged when a server is built
// for stdio, and once per route when the HTTP route factory is made.

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { Config } from "./config.js";
import { createMcpHttpHandler, type McpHttpHandler } from "./http-handler.js";
import { createReadinessCheck, type ReadinessResult } from "./readiness.js";
import { registerAgentExecutionTools } from "./domains/agentexecutions/tools.js";
import { registerAgentResources } from "./domains/agents/resources.js";
import { registerAgentTools } from "./domains/agents/tools.js";
import { registerChannelTools } from "./domains/channels/tools.js";
import type { BackendTarget } from "./domains/client.js";
import { registerConversationTools } from "./domains/conversation/tools.js";
import { registerEnvironmentResources } from "./domains/environments/resources.js";
import { registerEnvironmentTools } from "./domains/environments/tools.js";
import { registerExecutionControlTools } from "./domains/executions/tools.js";
import { registerMcpServerResources } from "./domains/mcpservers/resources.js";
import { registerMcpServerTools } from "./domains/mcpservers/tools.js";
import {
  loadCaptureContextFromEnv,
  type CaptureContext,
} from "./domains/memory/context.js";
import { registerMemoryTools } from "./domains/memory/tools.js";
import { registerSearchTools } from "./domains/search/tools.js";
import { registerSkillResources } from "./domains/skills/resources.js";
import { registerSkillTools } from "./domains/skills/tools.js";
import { registerWorkflowExecutionTools } from "./domains/workflowexecutions/tools.js";
import { registerTaskKindTools } from "./domains/workflows/taskkinds.js";
import { registerWorkflowResources } from "./domains/workflows/resources.js";
import { registerWorkflowTools } from "./domains/workflows/tools.js";
import { registerValidateWorkflowYamlTool } from "./domains/workflows/validate.js";
import { log } from "./logger.js";

/**
 * Server version. Overridable at publish/build time; "dev" otherwise, matching
 * the Go server's ldflags fallback.
 */
export const SERVER_VERSION = process.env.STIGMER_MCP_VERSION || "dev";

/** Grace period for draining in-flight HTTP requests on shutdown. */
const HTTP_SHUTDOWN_GRACE_MS = 5_000;

/**
 * Build a configured MCP server with every Stigmer tool registered. The backend
 * target (address + startup credential) is captured in each handler's closure.
 */
export function createServer(target: BackendTarget): McpServer {
  const roster = buildFullRoster(target);
  logRoster(roster);
  return roster.server;
}

/**
 * Build a channels-only MCP server: send_channel_message with the
 * agent-facing argument surface, and nothing else (the records-roster
 * pattern). This is the roster the
 * runner-synthesized channel attachment connects to; the structural
 * guarantee mirrors the records roster's. Served on the /channels HTTP
 * route and as the stdio roster when STIGMER_MCP_ROSTER=channels.
 */
export function createChannelsServer(target: BackendTarget): McpServer {
  const roster = buildChannelsRoster(target);
  logRoster(roster);
  return roster.server;
}

/**
 * Build a conversation-only MCP server: escalate_to_human with the
 * agent-facing argument surface, and nothing else (the channels-roster
 * pattern). This is the roster
 * the runner-synthesized conversation attachment connects to; the
 * structural guarantee mirrors the channels roster's.
 *
 * HTTP-only by design — served on the /conversation route, with NO
 * stdio roster value: escalate is cloud-only (OSS refuses
 * FAILED_PRECONDITION) AND session-token-only (the reach derives
 * identity from a session-scoped sandbox credential, which only the
 * bridge's per-request Bearer can carry — a stdio child's startup API
 * key never could), so a stdio shape would be a tool that can only
 * fail. Honest absence instead.
 */
export function createConversationServer(target: BackendTarget): McpServer {
  const roster = buildConversationRoster(target);
  logRoster(roster);
  return roster.server;
}

/**
 * Build a memory-only MCP server: remember with the agent-facing argument
 * surface, and nothing else (the channels-roster pattern).
 * This is the roster the runner-synthesized memory attachment connects
 * to; the structural guarantee mirrors the channels roster's. Served on
 * the /memory HTTP route and as the stdio roster when
 * STIGMER_MCP_ROSTER=memory.
 *
 * `startupContext` is the stdio-shape capture context, read from the
 * runner-set STIGMER_MEMORY_* environment at construction (the startup
 * API key pattern). Over HTTP each request's provenance headers
 * supersede it, so the http factory's env read is a harmless no-op.
 */
export function createMemoryServer(
  target: BackendTarget,
  startupContext: CaptureContext = loadCaptureContextFromEnv(),
): McpServer {
  const roster = buildMemoryRoster(target, startupContext);
  logRoster(roster);
  return roster.server;
}

/**
 * A built roster: the server, and the names its domains registered, so the
 * log's count and roster cannot drift from what is actually wired (the Go
 * server's startup log shape).
 */
interface BuiltRoster {
  readonly server: McpServer;
  /** The log label; "" for the full roster. */
  readonly label: string;
  readonly tools: readonly string[];
  readonly resources: readonly string[];
}

function buildFullRoster(target: BackendTarget): BuiltRoster {
  const server = new McpServer({ name: "mcp-server-stigmer", version: SERVER_VERSION });
  return {
    server,
    label: "",
    tools: registerTools(server, target),
    resources: registerResources(server, target),
  };
}

function buildChannelsRoster(target: BackendTarget): BuiltRoster {
  const server = new McpServer({ name: "mcp-server-stigmer-channels", version: SERVER_VERSION });
  return { server, label: "channels", tools: registerChannelTools(server, target), resources: [] };
}

function buildConversationRoster(target: BackendTarget): BuiltRoster {
  const server = new McpServer({ name: "mcp-server-stigmer-conversation", version: SERVER_VERSION });
  return { server, label: "conversation", tools: registerConversationTools(server, target), resources: [] };
}

function buildMemoryRoster(
  target: BackendTarget,
  startupContext: CaptureContext = loadCaptureContextFromEnv(),
): BuiltRoster {
  const server = new McpServer({ name: "mcp-server-stigmer-memory", version: SERVER_VERSION });
  return { server, label: "memory", tools: registerMemoryTools(server, target, startupContext), resources: [] };
}

function logRoster(roster: BuiltRoster): void {
  const suffix = roster.label === "" ? "" : ` (${roster.label} roster)`;
  log.info(`tools registered${suffix}`, { count: roster.tools.length, tools: roster.tools });
  if (roster.resources.length > 0) {
    log.info(`resources registered${suffix}`, { count: roster.resources.length, resources: roster.resources });
  }
}

/** Wire up every domain's tools; returns the names registered. */
function registerTools(server: McpServer, target: BackendTarget): string[] {
  return [
    ...registerSearchTools(server, target),
    ...registerAgentTools(server, target),
    ...registerAgentExecutionTools(server, target),
    ...registerMcpServerTools(server, target),
    ...registerSkillTools(server, target),
    ...registerWorkflowTools(server, target),
    ...registerValidateWorkflowYamlTool(server, target),
    ...registerTaskKindTools(server, target),
    ...registerWorkflowExecutionTools(server, target),
    ...registerExecutionControlTools(server, target),
    ...registerEnvironmentTools(server, target),
  ];
}

/**
 * Wire up every domain's resource templates (the discovery-to-read surface);
 * returns the names registered.
 */
function registerResources(server: McpServer, target: BackendTarget): string[] {
  return [
    ...registerAgentResources(server, target),
    ...registerMcpServerResources(server, target),
    ...registerSkillResources(server, target),
    ...registerWorkflowResources(server, target),
    ...registerEnvironmentResources(server, target),
  ];
}

/**
 * Serve over stdin/stdout until the client disconnects or `signal` aborts.
 *
 * Resolves on a clean disconnect (the MCP discovery probe connects, lists
 * tools/resources, then closes stdin → EOF). Protocol-level errors are logged
 * but do not terminate the process, mirroring the Go server treating EOF /
 * broken pipe as a normal shutdown rather than a failure.
 */
export async function serveStdio(server: McpServer, signal: AbortSignal): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  return new Promise<void>((resolve) => {
    const onAbort = () => void server.close();
    signal.addEventListener("abort", onAbort, { once: true });

    // The low-level Server's onclose/onerror are user hooks (not overwritten by
    // connect), so they are the safe place to observe lifecycle transitions.
    server.server.onclose = () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    server.server.onerror = (err) => log.error("mcp protocol error", { error: err.message });
  });
}

/**
 * Builds the server for one inbound HTTP request, selected by request path;
 * `undefined` means the route is not recognized and the request must be
 * refused (404), never served a default roster.
 */
export type RouteServerFactory = (path: string) => McpServer | undefined;

/** HTTP route serving the full roster: the bare origin every published config uses. */
export const FULL_ROUTE = "/";

/** HTTP route serving the channels-only roster. */
export const CHANNELS_ROUTE = "/channels";

/** HTTP route serving the conversation-only roster. */
export const CONVERSATION_ROUTE = "/conversation";

/** HTTP route serving the memory-only roster (memory capture). */
export const MEMORY_ROUTE = "/memory";

/**
 * The standard HTTP route dispatch: the full roster on {@link FULL_ROUTE},
 * the channels-only roster on {@link CHANNELS_ROUTE}, the
 * conversation-only roster on {@link CONVERSATION_ROUTE}, the
 * memory-only roster on {@link MEMORY_ROUTE} — and NOTHING
 * anywhere else.
 *
 * The closed route table is load-bearing, not tidiness. This dispatch
 * once fell through to the full roster for any unrecognized path, and a
 * production bridge predating /channels answered the runner's channel
 * attachment with the full roster: the agent got a server named
 * stigmer-channels with every management tool except the one send tool
 * it existed for (the 2026-08-05 stale-pin incident). An unknown route
 * is a deployment mismatch by definition — refuse it loudly so the
 * mismatch is visible at connect time, instead of serving tools the
 * caller was never meant to see.
 */
export function routedServerFactory(target: BackendTarget): RouteServerFactory {
  const routes = new Map<string, (t: BackendTarget) => BuiltRoster>([
    [FULL_ROUTE, buildFullRoster],
    [CHANNELS_ROUTE, buildChannelsRoster],
    [CONVERSATION_ROUTE, buildConversationRoster],
    [MEMORY_ROUTE, (t) => buildMemoryRoster(t)],
  ]);
  // Servers are built per request, quietly; each roster is logged once, here.
  for (const build of routes.values()) logRoster(build(target));
  return (path) => {
    const build = routes.get(path);
    return typeof build === "function" ? build(target).server : undefined;
  };
}

/**
 * Serve over Streamable HTTP until `signal` aborts: this process's own
 * listener, answering the liveness and readiness probes and handing every
 * other request to `handler` (see http-handler.ts for the stateless MCP
 * contract it serves).
 *
 * Each request is wrapped in access logging (16-hex request id, method, path,
 * status, duration). DNS-rebinding allow-lists are intentionally out of
 * parity scope (the Go server has none).
 *
 * `httpPort` "0" binds an ephemeral port; `onListening` is told the port the
 * listener got, once it accepts connections. A caller that needs a port must
 * take it from there, never probe one and hand it in: a probed port is free for
 * any other listener until this one binds it (stigmer#1469).
 */
export async function serveHttp(
  handler: McpHttpHandler,
  cfg: Config,
  signal: AbortSignal,
  hooks: { readonly onListening?: (port: number) => void } = {},
): Promise<void> {
  const checkReady = createReadinessCheck(cfg.stigmerServerAddress);

  const httpServer = createHttpServer((req, res) => {
    logAccess(req, res);
    void serveProbeOr(req, res, handler, checkReady);
  });

  return new Promise<void>((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(Number(cfg.httpPort), () => {
      const address = httpServer.address();
      const port = typeof address === "object" && address !== null ? address.port : Number(cfg.httpPort);
      log.info("HTTP transport listening", { addr: `:${port}`, auth_enabled: cfg.httpAuthEnabled });
      hooks.onListening?.(port);
    });

    signal.addEventListener(
      "abort",
      () => {
        log.info("HTTP server shutting down", { grace_period_ms: HTTP_SHUTDOWN_GRACE_MS });
        const force = setTimeout(() => httpServer.closeAllConnections?.(), HTTP_SHUTDOWN_GRACE_MS);
        httpServer.close((err) => {
          clearTimeout(force);
          if (err) reject(err);
          else resolve();
        });
      },
      { once: true },
    );
  });
}

/**
 * Serve stdio and HTTP concurrently. stdio binds a single server; HTTP builds
 * one server per request via the route factory. The first transport to settle aborts
 * the other, mirroring Go's serveBoth.
 */
export async function serveBoth(target: BackendTarget, cfg: Config, signal: AbortSignal): Promise<void> {
  const linked = new AbortController();
  const onParentAbort = () => linked.abort();
  signal.addEventListener("abort", onParentAbort, { once: true });

  const tasks = [
    serveStdio(stdioServer(target, cfg), linked.signal),
    serveHttp(httpHandler(target, cfg), cfg, linked.signal),
  ];

  try {
    await Promise.race(tasks);
  } finally {
    linked.abort();
    await Promise.allSettled(tasks);
    signal.removeEventListener("abort", onParentAbort);
  }
}

/**
 * The standalone transport's MCP handler: the production route table, with
 * the presence-only bearer check and OAuth discovery the configuration
 * names. The bearer is never validated here; stigmer-server validates it on
 * every tool call.
 */
export function httpHandler(target: BackendTarget, cfg: Config): McpHttpHandler {
  return createMcpHttpHandler({ target, authRequired: cfg.httpAuthEnabled, oauth: cfg.oauth });
}

/**
 * Answer the liveness and readiness probes, or hand the request to the MCP
 * handler. Never rejects: a rejection here would exit the process.
 */
async function serveProbeOr(
  req: IncomingMessage,
  res: ServerResponse,
  handler: McpHttpHandler,
  checkReady: () => Promise<ReadinessResult>,
): Promise<void> {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(`{"status":"ok"}\n`);
    return;
  }

  // Readiness = liveness AND a working backend hop (see readiness.ts for why
  // only the readiness probe may point here). Public like /health: Kubernetes
  // probes carry no bearer.
  if (req.method === "GET" && requestPath(req) === "/ready") {
    // Never rejects: the check turns every failure into a verdict (readiness.ts).
    const result = await checkReady();
    if (result.ready) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(`{"status":"ready"}\n`);
    } else {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "unready", reason: result.reason }) + "\n");
    }
    return;
  }

  await handler(req, res);
}

/**
 * The stdio server for the configured roster: the channels-only or
 * memory-only roster when STIGMER_MCP_ROSTER names one (what the OSS
 * runner-synthesized attachments spawn), the full roster otherwise.
 */
export function stdioServer(target: BackendTarget, cfg: Config): McpServer {
  if (cfg.roster === "channels") return createChannelsServer(target);
  if (cfg.roster === "memory") return createMemoryServer(target);
  return createServer(target);
}

/** Request path without the query string (mirrors Go's r.URL.Path). */
function requestPath(req: IncomingMessage): string {
  const url = req.url ?? "/";
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

/**
 * Attach access logging to a request: on completion, log a 16-hex request id,
 * method, path, status, and duration. Mirrors Go's requestLogger middleware.
 */
function logAccess(req: IncomingMessage, res: ServerResponse): void {
  const start = Date.now();
  const requestId = randomBytes(8).toString("hex");
  res.on("finish", () => {
    log.info("http request", {
      request_id: requestId,
      method: req.method,
      path: requestPath(req),
      status: res.statusCode,
      duration_ms: Date.now() - start,
    });
  });
}

/**
 * Reports whether an error represents a clean client disconnect (EOF / broken
 * pipe / abort) rather than a genuine failure, so discovery probes that connect
 * and immediately disconnect do not cause a non-zero exit. Mirrors Go's
 * isNormalShutdown.
 */
export function isNormalShutdown(err: unknown): boolean {
  if (err == null) return true;

  const name = (err as { name?: string }).name;
  if (name === "AbortError") return true;

  const code = (err as NodeJS.ErrnoException).code;
  if (code === "EPIPE" || code === "ABORT_ERR" || code === "ECONNRESET") return true;

  const message = err instanceof Error ? err.message : String(err);
  return message.includes("EOF") || message.includes("broken pipe");
}

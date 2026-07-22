// Server construction, tool registration, and transport entry points.
//
// Mirrors Go internal/server (server.go + http.go) plus the lifecycle helpers
// from pkg/mcpserver/run.go. The server is stateless: every per-request value
// (the credential, and thus the gRPC client) is derived from the transport's
// auth context, so the registration is identical regardless of transport.
//
// One structural difference from Go is called out in DD-008: the TS McpServer
// "assumes ownership" of a single transport, so `both` mode uses one McpServer
// per transport rather than sharing a single instance across stdio + HTTP.

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import type { Config } from "./config.js";
import { registerAgentResources } from "./domains/agents/resources.js";
import { registerAgentTools } from "./domains/agents/tools.js";
import type { BackendTarget } from "./domains/client.js";
import { registerMcpServerResources } from "./domains/mcpservers/resources.js";
import { registerMcpServerTools } from "./domains/mcpservers/tools.js";
import { registerRecordTools } from "./domains/records/tools.js";
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
 * Well-known location (RFC 9728 §3.1) of the OAuth 2.0 Protected Resource
 * Metadata document. Served only when OAuth discovery is enabled.
 */
const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

/**
 * Build a configured MCP server with every Stigmer tool registered. The backend
 * target (address + startup credential) is captured in each handler's closure.
 */
export function createServer(target: BackendTarget): McpServer {
  const server = new McpServer({ name: "mcp-server-stigmer", version: SERVER_VERSION });
  registerTools(server, target);
  registerResources(server, target);
  return server;
}

/**
 * Build a records-only MCP server: the five record tools with the
 * agent-facing argument surface, and nothing else (T05 R1). This is
 * the roster the runner-synthesized datastore attachment connects to —
 * a structural guarantee that an agent session never sees the
 * management tools (apply/delete/…) its empty approval maps would make
 * approval-free. Served on the /records HTTP route and as the stdio
 * roster when STIGMER_MCP_ROSTER=records.
 */
export function createRecordsServer(target: BackendTarget): McpServer {
  const server = new McpServer({ name: "mcp-server-stigmer-records", version: SERVER_VERSION });
  const tools = registerRecordTools(server, target, "agent");
  log.info("tools registered (records roster)", { count: tools.length, tools });
  return server;
}

/**
 * Wire up every domain's tools. Each domain returns the names it registered so
 * the startup log's count and roster cannot drift from what is actually wired,
 * matching the Go server's startup log shape.
 */
function registerTools(server: McpServer, target: BackendTarget): void {
  const tools = [
    ...registerSearchTools(server, target),
    ...registerAgentTools(server, target),
    ...registerMcpServerTools(server, target),
    ...registerSkillTools(server, target),
    ...registerWorkflowTools(server, target),
    ...registerValidateWorkflowYamlTool(server, target),
    ...registerTaskKindTools(server, target),
    ...registerWorkflowExecutionTools(server, target),
    // The record tools also serve external MCP clients — as direct
    // principals with the org argument and honest annotations (the
    // agent-facing variant lives on the records-only roster).
    ...registerRecordTools(server, target, "direct"),
  ];
  log.info("tools registered", { count: tools.length, tools });
}

/**
 * Wire up every domain's resource templates (the discovery-to-read surface).
 * Like {@link registerTools}, each domain returns the names it registered so the
 * startup log stays accurate.
 */
function registerResources(server: McpServer, target: BackendTarget): void {
  const resources = [
    ...registerAgentResources(server, target),
    ...registerMcpServerResources(server, target),
    ...registerSkillResources(server, target),
    ...registerWorkflowResources(server, target),
  ];
  log.info("resources registered", { count: resources.length, resources });
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

/** Builds a fresh, fully-registered server. One is created per MCP session. */
export type ServerFactory = () => McpServer;

/**
 * Builds the server for an inbound HTTP `initialize` request, selected
 * by request path. Only the initialize request consults the path — an
 * established session's transport already carries the server it was
 * built with, so follow-up requests dispatch by Mcp-Session-Id alone.
 */
export type RouteServerFactory = (path: string) => McpServer;

/** HTTP route serving the records-only roster (T05 R1). */
export const RECORDS_ROUTE = "/records";

/**
 * The standard HTTP route dispatch: the records-only roster on
 * {@link RECORDS_ROUTE}, the full roster everywhere else.
 */
export function routedServerFactory(target: BackendTarget): RouteServerFactory {
  return (path) => (path === RECORDS_ROUTE ? createRecordsServer(target) : createServer(target));
}

/**
 * Serve over Streamable HTTP until `signal` aborts.
 *
 * Each request carries its own credential via the Authorization header; the
 * (non-validating) auth layer extracts it onto `req.auth`, which the transport
 * surfaces to tool handlers as `extra.authInfo`. The application keeps no
 * per-user state.
 *
 * Spike A established the concurrency model: the TS SDK binds one McpServer to
 * one transport to one MCP session (a second `initialize` on a shared server
 * fails with "Server already initialized"). Unlike Go — whose SDK multiplexes
 * sessions over a single shared `*mcp.Server` — the TS server keeps a registry
 * of `sessionId → transport`, each built from `makeServer` on `initialize`. The
 * per-request Bearer passthrough is orthogonal and applies on every request.
 *
 * Each request is wrapped in access logging (16-hex request id, method, path,
 * status, duration) and, when OAuth discovery is enabled, RFC 9728 metadata is
 * served and a WWW-Authenticate challenge is attached to token-less requests.
 * DNS-rebinding allow-lists are intentionally out of parity scope (the Go server
 * has none).
 */
export async function serveHttp(
  makeServer: RouteServerFactory,
  cfg: Config,
  signal: AbortSignal,
): Promise<void> {
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createHttpServer((req, res) => {
    logAccess(req, res);
    void routeRequest(req, res, sessions, makeServer, cfg);
  });

  const addr = `:${cfg.httpPort}`;

  return new Promise<void>((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(Number(cfg.httpPort), () => {
      log.info("HTTP transport listening", { addr, auth_enabled: cfg.httpAuthEnabled });
    });

    signal.addEventListener(
      "abort",
      () => {
        log.info("HTTP server shutting down", { grace_period_ms: HTTP_SHUTDOWN_GRACE_MS });
        const force = setTimeout(() => httpServer.closeAllConnections?.(), HTTP_SHUTDOWN_GRACE_MS);
        httpServer.close((err) => {
          clearTimeout(force);
          for (const transport of sessions.values()) void transport.close();
          sessions.clear();
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
 * one server per session via the factory. The first transport to settle aborts
 * the other, mirroring Go's serveBoth.
 */
export async function serveBoth(target: BackendTarget, cfg: Config, signal: AbortSignal): Promise<void> {
  const linked = new AbortController();
  const onParentAbort = () => linked.abort();
  signal.addEventListener("abort", onParentAbort, { once: true });

  const tasks = [
    serveStdio(stdioServer(target, cfg), linked.signal),
    serveHttp(routedServerFactory(target), cfg, linked.signal),
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
 * Route an inbound HTTP request: liveness probe, the non-validating Bearer
 * extraction, then delegation to the session's MCP transport (reusing an
 * existing session or creating one for an `initialize` request).
 *
 * The token is never validated here — presence is the only check, and it is
 * forwarded unchanged to stigmer-server which performs validation. This mirrors
 * the Go authMiddleware exactly (inventory §4.2).
 */
async function routeRequest(
  req: IncomingMessage & { auth?: AuthInfo },
  res: ServerResponse,
  sessions: Map<string, StreamableHTTPServerTransport>,
  makeServer: RouteServerFactory,
  cfg: Config,
): Promise<void> {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(`{"status":"ok"}\n`);
    return;
  }

  // RFC 9728 Protected Resource Metadata — public, unauthenticated, and served
  // only when OAuth discovery is enabled. CORS-open so browser-based clients
  // (e.g. Claude Desktop's connector GUI) can discover the authorization server.
  if (cfg.oauth.enabled && requestPath(req) === PROTECTED_RESOURCE_METADATA_PATH) {
    serveProtectedResourceMetadata(req, res, cfg);
    return;
  }

  // Non-validating Bearer passthrough, applied to EVERY request so each call's
  // gRPC client uses that request's own credential.
  if (cfg.httpAuthEnabled) {
    const token = extractBearerToken(req);
    if (token === "") {
      const headers: Record<string, string> = { "Content-Type": "text/plain" };
      // RFC 9728 §5.1: point OAuth-capable clients at the metadata document.
      if (cfg.oauth.enabled) headers["WWW-Authenticate"] = bearerChallenge(cfg);
      res.writeHead(401, headers);
      res.end("missing or malformed Authorization: Bearer header");
      return;
    }
    req.auth = { token, clientId: "stigmer-mcp-passthrough", scopes: [] };
  }

  const path = requestPath(req);
  const sessionId = headerValue(req, "mcp-session-id");

  // Established session → dispatch to its transport.
  if (sessionId !== undefined) {
    const transport = sessions.get(sessionId);
    if (transport === undefined) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("unknown or expired MCP session");
      return;
    }
    await transport.handleRequest(req, res);
    return;
  }

  // No session → only an initialize POST may open one.
  if (req.method !== "POST") {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("missing Mcp-Session-Id header");
    return;
  }

  const body = await readJsonBody(req);
  if (!isInitializeRequest(body)) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Bad Request: an initialize request is required to open a session");
    return;
  }

  const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, transport);
    },
    onsessionclosed: (id) => {
      sessions.delete(id);
    },
  });
  transport.onclose = () => {
    if (transport.sessionId !== undefined) sessions.delete(transport.sessionId);
  };

  await makeServer(path).connect(transport);
  await transport.handleRequest(req, res, body);
}

/**
 * The stdio server for the configured roster: the records-only roster
 * when STIGMER_MCP_ROSTER=records (what the OSS runner-synthesized
 * datastore attachment spawns), the full roster otherwise.
 */
export function stdioServer(target: BackendTarget, cfg: Config): McpServer {
  return cfg.roster === "records" ? createRecordsServer(target) : createServer(target);
}

/** Return a single header value, collapsing the array form Node may produce. */
function headerValue(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Read and JSON-parse a request body (used to classify the initialize POST). */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(raw === "" ? null : JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
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
 * Serve the OAuth 2.0 Protected Resource Metadata document (RFC 9728), answering
 * the CORS preflight (OPTIONS) and the GET. Mirrors the Go SDK's
 * ProtectedResourceMetadataHandler output shape.
 */
function serveProtectedResourceMetadata(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: Config,
): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.writeHead(204);
    res.end();
    return;
  }

  const metadata: Record<string, unknown> = {
    resource: cfg.oauth.resource,
    authorization_servers: cfg.oauth.authorizationServers,
    bearer_methods_supported: ["header"],
    resource_name: "Stigmer MCP Server",
  };
  if (cfg.oauth.scopesSupported.length > 0) {
    metadata.scopes_supported = cfg.oauth.scopesSupported;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(metadata));
}

/**
 * Build the WWW-Authenticate challenge pointing OAuth clients at this server's
 * protected-resource-metadata document (RFC 9728 §5.1). Mirrors Go bearerChallenge.
 */
function bearerChallenge(cfg: Config): string {
  const metadataURL = cfg.oauth.resource.replace(/\/+$/, "") + PROTECTED_RESOURCE_METADATA_PATH;
  const params = [`realm="stigmer"`, `resource_metadata="${metadataURL}"`];
  if (cfg.oauth.scopesSupported.length > 0) {
    params.push(`scope="${cfg.oauth.scopesSupported.join(" ")}"`);
  }
  return "Bearer " + params.join(", ");
}

/** Parse the "Authorization: Bearer <token>" header; "" when absent/malformed. */
function extractBearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization;
  if (!header) return "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return "";
  return header.slice(prefix.length).trim();
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

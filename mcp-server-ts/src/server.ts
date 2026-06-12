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
import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import type { Config } from "./config";
import { registerAgentTools } from "./domains/agents/tools";
import type { BackendTarget } from "./domains/client";
import { log } from "./logger";

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
  const server = new McpServer({ name: "mcp-server-stigmer", version: SERVER_VERSION });
  registerTools(server, target);
  return server;
}

/**
 * Wire up every domain's tools. The agents domain is the canonical pattern; the
 * remaining domains are filled in T02. The count is logged for operator
 * visibility, matching the Go server's startup log.
 */
function registerTools(server: McpServer, target: BackendTarget): void {
  registerAgentTools(server, target);
  log.info("tools registered", { count: 1, tools: ["get_agent"] });
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
 * This is the minimal transport that proves the model (Spike A). Full hardening
 * — request-id logging, OAuth (RFC 9728) discovery, DNS-rebinding allow-lists,
 * and `both`-mode polish — lands in T02.
 */
export async function serveHttp(makeServer: ServerFactory, cfg: Config, signal: AbortSignal): Promise<void> {
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createHttpServer((req, res) => {
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
    serveStdio(createServer(target), linked.signal),
    serveHttp(() => createServer(target), cfg, linked.signal),
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
  makeServer: ServerFactory,
  cfg: Config,
): Promise<void> {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(`{"status":"ok"}\n`);
    return;
  }

  // Non-validating Bearer passthrough, applied to EVERY request so each call's
  // gRPC client uses that request's own credential.
  if (cfg.httpAuthEnabled) {
    const token = extractBearerToken(req);
    if (token === "") {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("missing or malformed Authorization: Bearer header");
      return;
    }
    req.auth = { token, clientId: "stigmer-mcp-passthrough", scopes: [] };
  }

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

  await makeServer().connect(transport);
  await transport.handleRequest(req, res, body);
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

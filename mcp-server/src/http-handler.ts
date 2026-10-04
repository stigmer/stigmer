// The stateless, mountable Streamable HTTP handler for Stigmer's MCP rosters.
//
// One request handler a host mounts on its own node:http server: the
// standalone transport (serveHttp) and any process that serves MCP beside
// other traffic run the same code. Every request is served by a fresh
// McpServer and a stateless transport, answered as plain JSON. No tool sends
// anything outside its own response (no notifications, progress, sampling or
// elicitation), so a session would buy nothing and cost an unbounded session
// map, a single-replica limit and dropped connections on every restart; with
// no notifications, an event stream would carry exactly one message.
//
// Trade-offs this module embodies:
// - A route's server is built per request. Registration is in-memory work,
//   small against a tool call's own backend RPC; the roster is logged once,
//   when the route factory is made, never per request.
// - The handler never rejects. A rejected promise inside a node:http request
//   listener exits a Node process, so a body that is not JSON answers 400, a
//   body over the cap 413, and any other failure 500 (or a destroyed response
//   when headers are already out), each logged.
// - The body is read here, under a cap, and handed to the transport parsed:
//   the SDK transport otherwise reads it unbounded.
// - The host may refuse a bearer at the door through `authenticate`; the
//   handler owns the wire shape (401 with the OAuth challenge, so clients
//   refresh and retry; 503 when the host cannot decide). Every accepted
//   request still forwards its own bearer to stigmer-server, which
//   authorizes every tool call. Without the hook the handler is a pure,
//   non-validating passthrough.
// - Exported types name only Node and package types, so a host's typecheck
//   never depends on the MCP SDK's typings.

import type { IncomingMessage, ServerResponse } from "node:http";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import type { OAuthConfig } from "./config.js";
import type { BackendTarget } from "./domains/client.js";
import { log } from "./logger.js";
import { routedServerFactory, type RouteServerFactory } from "./server.js";
import { trimTrailing } from "./trim.js";

/**
 * Well-known location (RFC 9728 §3.1) of the OAuth 2.0 Protected Resource
 * Metadata document. Served only when OAuth discovery is enabled.
 */
export const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

/**
 * Default request-body cap: gRPC's default maximum receive message size, so
 * no body this handler admits is one stigmer-server would refuse for size.
 */
export const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * A host's verdict on a bearer token: accepted (serve the request), refused
 * (the token is not valid here: 401 with the challenge), or unavailable (the
 * host cannot decide right now, e.g. its key set is unreachable: 503).
 */
export type BearerVerdict = "accepted" | "refused" | "unavailable";

/** Settings shared by every handler, whatever builds its route's servers. */
export interface McpHttpHandlerSettings {
  /** Whether a request must carry `Authorization: Bearer <token>`. */
  readonly authRequired: boolean;
  /** RFC 9728 discovery; when enabled, the metadata document is served and 401s carry the challenge. */
  readonly oauth: OAuthConfig;
  /** Request-body cap in bytes; {@link DEFAULT_MAX_BODY_BYTES} when unset. */
  readonly maxBodyBytes?: number;
  /**
   * The host's door check, consulted on every request that carries a
   * bearer. A throw reads as "unavailable": a host fault must never read as
   * a bad credential.
   */
  readonly authenticate?: (token: string) => Promise<BearerVerdict>;
}

/** Options for {@link createMcpHttpHandler}. */
export interface McpHttpHandlerOptions extends McpHttpHandlerSettings {
  /** The stigmer-server every tool dials, and the fallback credential. */
  readonly target: BackendTarget;
}

/** A node:http request handler. It never rejects. */
export type McpHttpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/**
 * The handler serving Stigmer's closed route table: the full roster on `/`,
 * and the channels, conversation and memory rosters on their routes. The
 * host answers its own probes; every other request may be handed here.
 */
export function createMcpHttpHandler(options: McpHttpHandlerOptions): McpHttpHandler {
  return createRoutedHandler(routedServerFactory(options.target), options);
}

/**
 * The handler over any route factory. {@link createMcpHttpHandler} passes
 * the production route table; tests pass their own servers.
 */
export function createRoutedHandler(
  makeServer: RouteServerFactory,
  settings: McpHttpHandlerSettings,
): McpHttpHandler {
  const maxBodyBytes = settings.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return async (req, res) => {
    try {
      await serveRequest(req, res, makeServer, settings, maxBodyBytes);
    } catch (err) {
      log.error("mcp request failed", { path: requestPath(req), error: errorMessage(err) });
      if (!res.headersSent) {
        jsonRpcError(res, 500, -32603, "Internal server error");
      } else if (!res.writableEnded) {
        res.destroy();
      }
    }
  };
}

async function serveRequest(
  req: IncomingMessage & { auth?: AuthInfo },
  res: ServerResponse,
  makeServer: RouteServerFactory,
  settings: McpHttpHandlerSettings,
  maxBodyBytes: number,
): Promise<void> {
  const path = requestPath(req);

  // RFC 9728 Protected Resource Metadata: public, and CORS-open so
  // browser-based clients can discover the authorization server.
  if (settings.oauth.enabled && path === PROTECTED_RESOURCE_METADATA_PATH) {
    serveProtectedResourceMetadata(req, res, settings.oauth);
    return;
  }

  const token = extractBearerToken(req);
  if (token === "" && settings.authRequired) {
    jsonRpcError(res, 401, -32000, "missing or malformed Authorization: Bearer header", challenge(settings.oauth));
    return;
  }
  if (token !== "") {
    const verdict = await admit(settings, token);
    switch (verdict) {
      case "accepted":
        break;
      case "refused":
        jsonRpcError(res, 401, -32000, "invalid or expired bearer token", challenge(settings.oauth));
        return;
      case "unavailable":
        jsonRpcError(res, 503, -32000, "authentication is temporarily unavailable");
        return;
      /* v8 ignore next 4 -- @preserve: the exhaustiveness guard; BearerVerdict is a closed union, so no value reaches it */
      default: {
        const unreachable: never = verdict;
        throw new Error(`unknown bearer verdict: ${String(unreachable)}`);
      }
    }
    // Forwarded unchanged: each tool call's backend client uses this
    // request's own credential.
    req.auth = { token, clientId: "stigmer-mcp-passthrough", scopes: [] };
  }

  // The closed route table: an unknown route is a deployment mismatch and
  // is refused, never served a default roster (see routedServerFactory).
  const server = makeServer(path);
  if (server === undefined) {
    jsonRpcError(res, 404, -32000, `unknown MCP route: ${path}`);
    return;
  }

  // Stateless: no stream to open (GET) and no session to end (DELETE). The
  // streamable-HTTP spec reads 405 on GET as "no stream offered".
  if (req.method !== "POST") {
    jsonRpcError(res, 405, -32000, "Method not allowed.", { Allow: "POST" });
    return;
  }

  const read = await readBody(req, maxBodyBytes);
  switch (read.kind) {
    case "ok":
      break;
    case "invalid":
      log.warn("mcp request body is not JSON", { path });
      jsonRpcError(res, 400, -32700, "Parse error: Invalid JSON");
      return;
    case "too-large":
      log.warn("mcp request body over the cap", { path, max_bytes: maxBodyBytes });
      // Connection: close ends the upload with the response instead of
      // draining an arbitrarily long body.
      jsonRpcError(res, 413, -32000, `Payload Too Large: the body exceeds ${maxBodyBytes} bytes`, {
        Connection: "close",
      });
      return;
    case "aborted":
      return;
    /* v8 ignore next 4 -- @preserve: the exhaustiveness guard; BodyRead is a closed union, so no value reaches it */
    default: {
      const unreachable: never = read;
      throw new Error(`unknown body read: ${String(unreachable)}`);
    }
  }

  await serveMcp(server, req, res, read.body);
}

/**
 * Serve one JSON-RPC exchange on a fresh stateless transport. Settles when
 * the transport has answered or the client has gone, whichever is first: a
 * client that disconnects before its answer leaves the transport's promise
 * pending, and the handler must still settle.
 */
async function serveMcp(
  server: McpServer,
  req: IncomingMessage & { auth?: AuthInfo },
  res: ServerResponse,
  body: unknown,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const closed = new Promise<undefined>((resolve) => {
    res.once("close", () => {
      // McpServer.close closes its transport too.
      server.close().catch((err: unknown) => log.warn("mcp server close failed", { error: errorMessage(err) }));
      resolve(undefined);
    });
  });

  await server.connect(transport);
  const handled = transport.handleRequest(req, res, body).then(
    () => undefined,
    (err: unknown) => ({ failure: err }),
  );
  const outcome = await Promise.race([handled, closed]);
  if (outcome !== undefined) throw outcome.failure;
}

async function admit(settings: McpHttpHandlerSettings, token: string): Promise<BearerVerdict> {
  if (settings.authenticate === undefined) return "accepted";
  try {
    return await settings.authenticate(token);
  } catch (err) {
    log.error("bearer check failed", { error: errorMessage(err) });
    return "unavailable";
  }
}

type BodyRead =
  | { readonly kind: "ok"; readonly body: unknown }
  | { readonly kind: "invalid" }
  | { readonly kind: "too-large" }
  | { readonly kind: "aborted" };

/** Read and parse a JSON body, never buffering more than `maxBytes`. */
function readBody(req: IncomingMessage, maxBytes: number): Promise<BodyRead> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return Promise.resolve({ kind: "too-large" });
  }

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (read: BodyRead) => {
      if (settled) return;
      settled = true;
      resolve(read);
    };

    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        chunks.length = 0;
        settle({ kind: "too-large" });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        settle({ kind: "ok", body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      } catch {
        settle({ kind: "invalid" });
      }
    });
    req.on("error", () => settle({ kind: "aborted" }));
    req.on("close", () => settle({ kind: "aborted" }));
  });
}

/**
 * Write a JSON-RPC-framed refusal, byte-compatible with the SDK transport's
 * own createJsonErrorResponse: `{"jsonrpc":"2.0","error":{code,message},"id":null}`
 * with Content-Type application/json. The HTTP status stays authoritative;
 * the body exists for strict MCP clients that parse refusals instead of
 * surfacing an opaque content-type error (stigmer/stigmer#316). The
 * transport-level family uses -32000, per the SDK's convention.
 */
function jsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
  headers?: Record<string, string>,
): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

/** Request path without the query string. */
function requestPath(req: IncomingMessage): string {
  const url = req.url ?? "/";
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

/**
 * Serve the OAuth 2.0 Protected Resource Metadata document (RFC 9728),
 * answering the CORS preflight (OPTIONS) and the GET.
 */
function serveProtectedResourceMetadata(req: IncomingMessage, res: ServerResponse, oauth: OAuthConfig): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.writeHead(204);
    res.end();
    return;
  }

  const metadata: Record<string, unknown> = {
    resource: oauth.resource,
    authorization_servers: oauth.authorizationServers,
    bearer_methods_supported: ["header"],
    resource_name: "Stigmer MCP Server",
  };
  if (oauth.scopesSupported.length > 0) {
    metadata.scopes_supported = oauth.scopesSupported;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(metadata));
}

/**
 * The WWW-Authenticate challenge pointing OAuth clients at the
 * protected-resource-metadata document (RFC 9728 §5.1); none when discovery
 * is off.
 */
function challenge(oauth: OAuthConfig): Record<string, string> | undefined {
  if (!oauth.enabled) return undefined;
  const metadataURL = trimTrailing(oauth.resource, "/") + PROTECTED_RESOURCE_METADATA_PATH;
  const params = [`realm="stigmer"`, `resource_metadata="${metadataURL}"`];
  if (oauth.scopesSupported.length > 0) {
    params.push(`scope="${oauth.scopesSupported.join(" ")}"`);
  }
  return { "WWW-Authenticate": "Bearer " + params.join(", ") };
}

/** Parse the "Authorization: Bearer <token>" header; "" when absent or malformed. */
function extractBearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization;
  if (!header) return "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return "";
  return header.slice(prefix.length).trim();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

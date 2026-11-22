/**
 * The platform MCP lane: the memory, channels and conversation rosters a
 * runner gives an agent's turn, served on the unified port under
 * `/v1/mcp/` (`/v1/mcp/memory`, `/v1/mcp/channels`, `/v1/mcp/conversation`).
 *
 * Why it exists. A runner gives each turn those three rosters. With a
 * computer, the runner may start `stigmer mcp-server` as a local child for
 * them; a conversation without a computer runs in an agent program that
 * may start no process at all, so its runner reaches them over HTTP, here,
 * at the address it already holds for this server. A composition opts in
 * through `ServerExtension.servesPlatformMcp` (extensions/registry.ts); one
 * that serves the rosters elsewhere (on a port of its own) or not at all
 * leaves it undeclared, and the prefix answers the adapter's 404.
 *
 * What the lane decides, and why:
 *
 * - The rosters are `@stigmer/mcp-server`'s own handler, loaded from its
 *   built `./http` entry so this package runs unbundled under plain Node.
 *   The lane strips its prefix and hands the request over unread.
 * - Only the three platform routes. The package's full roster (`/`) is an
 *   MCP client's door to the whole API, which nothing here needs; every
 *   other path under the prefix is a 404 before the handler runs.
 * - The tools dial this server's own unified port on loopback, read from
 *   the bound port at the first request, never the in-process transport:
 *   that transport runs as the internal caller and skips the caller guards,
 *   so every tool call would have to carry the caller's identity by hand.
 *   Over loopback each call runs through the serving chain any client gets,
 *   and each tool's own authorization runs.
 * - The door check follows the server's posture. Where it signs callers in,
 *   a request must carry a bearer the composed verifier chain claims (the
 *   run credential a runner holds, a person's token, an API key): no bearer
 *   or an unclaimed one is a 401, a verifier fault a 503 (an outage never
 *   reads as a bad credential), and the accepted bearer is the one every
 *   tool call carries. Where it trusts every local caller, the header is
 *   ignored and the calls carry none, exactly as any tokenless request to
 *   this server is its operator; the router's local-only check
 *   (local-only.ts) has already run.
 * - HTTP/1.1 only. The package's handler takes Node's HTTP/1.1 request
 *   shapes, and an MCP client speaks HTTP/1.1 to a cleartext URL; an
 *   HTTP/2 request is answered 505 with a sentence.
 * - The package logs through a process-wide logger of its own, to stderr;
 *   the lane sets it to JSON at `warn`, so its roster lines stay out of the
 *   server's log and its failures do not.
 *
 * Proven by __tests__/lane.test.ts.
 */
import { IncomingMessage, ServerResponse } from "node:http";

import { Code, ConnectError } from "@connectrpc/connect";
import {
  configureLogger,
  createMcpHttpHandler,
  type BearerVerdict,
  type McpHttpHandler,
} from "@stigmer/mcp-server/http";

import type { Logger } from "../../boot/logger.js";
import type { IdentityVerifier } from "../../extensions/identity.js";
import { authenticateBearerToken } from "../../pipeline/interceptors/auth.js";
import { PLATFORM_MCP_PATH_PREFIX } from "../constants.js";
import type { LaneHandler, LaneRequest, LaneResponse } from "../lanes.js";

/** The routes the lane serves, as the package names them. */
export const PLATFORM_MCP_ROUTES: ReadonlySet<string> = new Set([
  "/memory",
  "/channels",
  "/conversation",
]);

/** The answers the lane gives itself, before the package's handler runs. */
export const PLATFORM_MCP_UNKNOWN_ROUTE =
  "this server serves the memory, channels and conversation MCP rosters under /v1/mcp/; the path names none of them";
export const PLATFORM_MCP_NOT_LISTENING =
  "the server is not listening yet; retry";
export const PLATFORM_MCP_HTTP2_REFUSED = "the MCP lane speaks HTTP/1.1";

/** How the lane checks a caller, by the server's posture. */
export type PlatformMcpAuthentication =
  | { readonly required: false }
  | {
      readonly required: true;
      readonly identityVerifiers: ReadonlyArray<IdentityVerifier>;
    };

export interface PlatformMcpLaneOptions {
  readonly logger: Logger;
  /** The unified port's bound port, once the server listens; undefined before. */
  readonly backendPort: () => number | undefined;
  readonly authentication: PlatformMcpAuthentication;
  /** The package's handler factory; the tests stand one in. */
  readonly createHandler?: typeof createMcpHttpHandler;
}

export function createPlatformMcpLane(
  options: PlatformMcpLaneOptions,
): LaneHandler {
  let handler: McpHttpHandler | undefined;
  const handlerFor = (port: number): McpHttpHandler => {
    if (handler === undefined) {
      configureLogger({ level: "warn", format: "json" });
      handler = (options.createHandler ?? createMcpHttpHandler)({
        target: { serverAddress: `127.0.0.1:${port}`, apiKey: "" },
        authRequired: options.authentication.required,
        oauth: {
          enabled: false,
          resource: "",
          authorizationServers: [],
          scopesSupported: [],
        },
        ...(options.authentication.required
          ? {
              authenticate: bearerCheck(
                options.authentication.identityVerifiers,
                options.logger,
              ),
            }
          : {}),
      });
    }
    return handler;
  };

  return (request: LaneRequest, response: LaneResponse): void => {
    if (
      !(request instanceof IncomingMessage) ||
      !(response instanceof ServerResponse)
    ) {
      answer(response, 505, PLATFORM_MCP_HTTP2_REFUSED);
      return;
    }
    const url = request.url ?? "";
    const queryAt = url.indexOf("?");
    const path = queryAt < 0 ? url : url.slice(0, queryAt);
    const route = path.slice(PLATFORM_MCP_PATH_PREFIX.length - 1);
    if (
      !path.startsWith(PLATFORM_MCP_PATH_PREFIX) ||
      !PLATFORM_MCP_ROUTES.has(route)
    ) {
      answer(response, 404, PLATFORM_MCP_UNKNOWN_ROUTE);
      return;
    }
    const port = options.backendPort();
    if (port === undefined) {
      answer(response, 503, PLATFORM_MCP_NOT_LISTENING);
      return;
    }
    request.url = queryAt < 0 ? route : route + url.slice(queryAt);
    // The package's handler never rejects: it answers every failure itself.
    void handlerFor(port)(request, response);
  };
}

/** The door check over the composed verifier chain. */
export function bearerCheck(
  identityVerifiers: ReadonlyArray<IdentityVerifier>,
  logger: Logger,
): (token: string) => Promise<BearerVerdict> {
  return async (token) => {
    try {
      const caller = await authenticateBearerToken(
        identityVerifiers,
        token,
        logger,
      );
      return caller === undefined ? "refused" : "accepted";
    } catch (error) {
      // A verifier refuses with UNAUTHENTICATED; any other throw is a
      // verifier fault, which must never read as a bad credential.
      return error instanceof ConnectError &&
        error.code === Code.Unauthenticated
        ? "refused"
        : "unavailable";
    }
  };
}

function answer(
  response: LaneResponse,
  status: number,
  sentence: string,
): void {
  response.statusCode = status;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(sentence);
}

// The `@stigmer/mcp-server/http` entry: the mountable HTTP handler alone, for
// a host that runs this package unbundled under plain Node.
//
// Why a second entry. In this repository the package's "." export is its
// TypeScript source (so the CLI's bundler and the suites read it as written),
// and so is @stigmer/client's, which it imports. A host whose own build runs
// unbundled under plain Node, such as the open-source server's tsc build, can
// load neither. This entry is built into one self-contained file,
// dist/http.js (scripts/bundle.mjs), with the client, the API stubs and the
// MCP SDK inside it, and `exports["./http"]` points at that file in this
// repository and when published alike.
//
// Trade-offs this module embodies:
// - Its public types are declared here, structurally, and name only Node's
//   types, so dist/http.d.ts imports nothing a host would have to resolve.
//   Passing them to the source handler below is the compile-time proof that
//   they still match it.
// - The target is the server address and a startup key: a host over HTTP
//   never hands the handler a token provider or local files.
// - The bundle carries its own copy of the package's logger, so the logger
//   that governs this handler is the one this entry exports.

import type { IncomingMessage, ServerResponse } from "node:http";

import {
  createMcpHttpHandler as createSourceHandler,
  type BearerVerdict as SourceBearerVerdict,
} from "./http-handler.js";
import { configureLogger as configureSourceLogger } from "./logger.js";

/**
 * A host's verdict on a bearer token: accepted (serve the request), refused
 * (401 with the challenge), or unavailable (the host cannot decide: 503).
 */
export type BearerVerdict = "accepted" | "refused" | "unavailable";

/** RFC 9728 discovery settings; disabled, no metadata document is served. */
export interface McpHttpOAuth {
  readonly enabled: boolean;
  readonly resource: string;
  readonly authorizationServers: string[];
  readonly scopesSupported: string[];
}

/** Options for {@link createMcpHttpHandler}. */
export interface McpHttpHandlerOptions {
  /**
   * The stigmer-server every tool dials (a gRPC address such as
   * `127.0.0.1:7234`), and the credential used when a request brings none
   * (auth off only; "" for none).
   */
  readonly target: { readonly serverAddress: string; readonly apiKey: string };
  /**
   * Whether a request must carry `Authorization: Bearer <token>`, which then
   * becomes that request's credential for every tool call. Off, the header
   * is ignored and every call uses `target.apiKey`.
   */
  readonly authRequired: boolean;
  readonly oauth: McpHttpOAuth;
  /** Request-body cap in bytes; the server's own message limit when unset. */
  readonly maxBodyBytes?: number;
  /** The host's door check when auth is required; a throw reads as unavailable. */
  readonly authenticate?: (token: string) => Promise<BearerVerdict>;
}

/** A node:http request handler that never rejects; the request must reach it unread. */
export type McpHttpHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void>;

/**
 * The handler serving Stigmer's closed route table: the full roster on `/`,
 * and the channels, conversation and memory rosters on `/channels`,
 * `/conversation` and `/memory`. POST only.
 */
export function createMcpHttpHandler(
  options: McpHttpHandlerOptions,
): McpHttpHandler {
  return createSourceHandler(options);
}

/** Configure the log level and format of this entry's handler (stderr). */
export function configureLogger(options: {
  readonly level: string;
  readonly format: string;
}): void {
  configureSourceLogger(options);
}

// The verdict declared here is the source's, in both directions: a change to
// either fails this package's typecheck.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;
// Not exported: the declaration file must name nothing outside this module.
type VerdictMatchesSource = AssertTrue<
  Same<BearerVerdict, SourceBearerVerdict>
>;

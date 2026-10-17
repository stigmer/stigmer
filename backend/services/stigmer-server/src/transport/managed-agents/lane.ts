/**
 * The Managed Agents lane: a session's events served on Claude Managed
 * Agents' own HTTP wire, so Anthropic's SDK, pointed at a Stigmer server
 * with a Stigmer API key, lists, streams and sends a session's events
 * unchanged (`client.beta.sessions.events.list`, `.stream`, `.send`).
 *
 *   GET  /v1/sessions/{id}/events          list.ts
 *   POST /v1/sessions/{id}/events          send.ts
 *   GET  /v1/sessions/{id}/events/stream   stream.ts
 *
 * This module is the HTTP edge only: the route, the method, the version
 * rule (version.ts), the caller's credentials, the body, and the answer's
 * shape. Every read and every answer is a native method's, reached through
 * the serving chain held in memory (call.ts), so the lane decides nothing
 * the native API does not.
 *
 * Credentials. Anthropic's SDK sends its key as `X-Api-Key` (its default
 * `apiKey` option) or as `Authorization: Bearer` (`authToken`); the lane
 * accepts both and hands the chain a bearer token, and refuses a request
 * whose two headers disagree rather than choose between them. On a server
 * that requires no sign-in, every caller is the local person, as a
 * tokenless native call is; the SDK always sends some key, and the native
 * chain refuses a token no verifier claims, so there the lane forwards no
 * credential at all. That grants nothing a tokenless native call lacks.
 * Besides the credential, only `origin` is forwarded (a caller guard reads
 * it); nothing else a caller sends reaches the chain.
 *
 * Routing is by the paths' fixed shapes. Anything under the prefix that is
 * not one of them answers 404 in Anthropic's envelope; a method a path does
 * not serve answers 405 with `Allow`. That includes OPTIONS: the lane sets
 * no CORS headers, and a browser reads sessions through Stigmer's own API.
 *
 * The lane router is synchronous, so each request runs detached with a
 * terminal catch (a write to a vanished client must never escape as an
 * unhandled rejection), and writes one log line: method, route shape,
 * status, request id and duration, never a body or a credential.
 *
 * Proven by __tests__/rules.test.ts (routes and credentials),
 * __tests__/lane-composed.test.ts (the lane on a composed server, both
 * postures) and the session-events-managed-agents conformance suites.
 */
import type { Readable } from "node:stream";

import { ConnectError, createClient, type Transport } from "@connectrpc/connect";

import { RunCommandController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/command_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { SessionQueryController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/query_pb";

import type { Logger } from "../../boot/logger.js";
import { parseBearerToken } from "../../pipeline/interceptors/auth.js";
import { generateId } from "../../pipeline/steps/defaults.js";
import { MANAGED_AGENTS_PATH_PREFIX, MAX_MESSAGE_BYTES } from "../constants.js";
import type { LaneHandler, LaneRequest, LaneResponse } from "../lanes.js";
import type { LaneCall, LaneClients } from "./call.js";
import { INTERNAL_ERROR_MESSAGE, isLaneError, laneError, laneErrorOf, notFound, type LaneError } from "./errors.js";
import { serveList } from "./list.js";
import { parseListQuery, parseStreamQuery } from "./query.js";
import { writeError } from "./respond.js";
import { parseSendBody, serveSend } from "./send.js";
import { serveStream, STREAM_KEEPALIVE_MS } from "./stream.js";
import { selectManagedAgentsVersion } from "./version.js";

export interface ManagedAgentsLaneOptions {
  /** The serving chain in memory (call.ts): never the in-process transport. */
  readonly transport: Transport;
  /** The server's posture: false forwards no credential (module header). */
  readonly authenticationRequired: boolean;
  readonly logger: Logger;
  /** Unix milliseconds, for a turn's name. */
  readonly now?: () => number;
  /** The stream's keep-alive interval. */
  readonly keepAliveMs?: number;
}

/** A path the lane serves, and the session it names. */
export interface LaneRoute {
  readonly kind: "events" | "stream";
  readonly sessionId: string;
}

/** The route shapes, as the log line names them. */
const ROUTE_SHAPES = {
  events: `${MANAGED_AGENTS_PATH_PREFIX}{id}/events`,
  stream: `${MANAGED_AGENTS_PATH_PREFIX}{id}/events/stream`,
} as const;

/** The prefix of every request id the lane mints (`req_<ulid>`, as Anthropic's are `req_…`). */
const REQUEST_ID_PREFIX = "req";

export function createManagedAgentsLane(options: ManagedAgentsLaneOptions): LaneHandler {
  const clients: LaneClients = {
    sessionQuery: createClient(SessionQueryController, options.transport),
    sessionCommand: createClient(SessionCommandController, options.transport),
    runCommand: createClient(RunCommandController, options.transport),
  };
  const now = options.now ?? Date.now;
  const keepAliveMs = options.keepAliveMs ?? STREAM_KEEPALIVE_MS;

  return (request, response) => {
    const startedAt = performance.now();
    const requestId = generateId(REQUEST_ID_PREFIX);
    const path = (request.url ?? "").split("?", 1)[0] ?? "";
    const route = routeOf(path);
    const fields = {
      method: request.method ?? "",
      route: route === undefined ? "unknown" : ROUTE_SHAPES[route.kind],
      requestId,
    };
    serve(request, response, route, requestId, { clients, now, keepAliveMs, ...options })
      .then((status) => {
        const logged = { ...fields, status, durationMs: Math.round(performance.now() - startedAt) };
        if (status >= 500) {
          options.logger.error("managed agents lane request failed", logged);
        } else if (status === 404) {
          options.logger.debug("managed agents lane request found nothing", logged);
        } else if (status >= 400) {
          options.logger.warn("managed agents lane client error", logged);
        } else {
          options.logger.info("managed agents lane request", logged);
        }
      })
      .catch((error: unknown) => {
        options.logger.error("managed agents lane handler failed", {
          ...fields,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!response.headersSent) {
          writeError(response, requestId, laneError(500, "api_error", INTERNAL_ERROR_MESSAGE));
        } else if (!response.writableEnded) {
          response.end();
        }
      });
  };
}

interface ServeContext {
  readonly clients: LaneClients;
  readonly now: () => number;
  readonly keepAliveMs: number;
  readonly authenticationRequired: boolean;
  readonly logger: Logger;
}

/** One request, start to finish; resolves to the status answered. */
async function serve(
  request: LaneRequest,
  response: LaneResponse,
  route: LaneRoute | undefined,
  requestId: string,
  context: ServeContext,
): Promise<number> {
  const refuse = (error: LaneError, refuseOptions: { readonly allow?: string } = {}): number => {
    writeError(response, requestId, error, { ...refuseOptions, noRetry: request.method === "POST" });
    return error.status;
  };
  if (route === undefined) {
    return refuse(
      notFound(
        `this API serves ${ROUTE_SHAPES.events} (GET, POST) and ${ROUTE_SHAPES.stream} (GET), nothing else under ${MANAGED_AGENTS_PATH_PREFIX}`,
      ),
    );
  }
  const method = request.method ?? "";
  const allow = route.kind === "events" ? "GET, POST" : "GET";
  if (!allow.split(", ").includes(method)) {
    return refuse(laneError(405, "invalid_request_error", `${method} is not served here; this path serves ${allow}`), {
      allow,
    });
  }
  const version = selectManagedAgentsVersion(headerOf(request, "anthropic-beta"));
  if (!version.served) {
    return refuse(laneError(400, "invalid_request_error", version.message));
  }
  const headers = forwardedHeaders(request, context.authenticationRequired);
  if (isLaneError(headers)) {
    return refuse(headers);
  }

  const abort = new AbortController();
  response.on("close", () => abort.abort());
  const call: LaneCall = {
    sessionId: route.sessionId,
    clients: context.clients,
    options: { headers, signal: abort.signal },
    requestId,
  };
  const params = new URLSearchParams((request.url ?? "").split("?", 2)[1] ?? "");
  try {
    if (route.kind === "stream") {
      const query = parseStreamQuery(params);
      return isLaneError(query) ? refuse(query) : await serveStream(call, query, response, context.keepAliveMs);
    }
    if (method === "GET") {
      const query = parseListQuery(params);
      return isLaneError(query) ? refuse(query) : await serveList(call, query, response);
    }
    const body = await readJsonBody(request);
    if (isLaneError(body)) {
      return refuse(body);
    }
    const events = parseSendBody(body.value);
    return isLaneError(events) ? refuse(events) : await serveSend(call, events, response, context.now);
  } catch (error) {
    if (abort.signal.aborted) {
      // The client left; there is no one to answer.
      return 499;
    }
    const answered = laneErrorOf(error);
    if (!(error instanceof ConnectError)) {
      context.logger.error("managed agents lane call failed", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return refuse(answered);
  }
}

/** The lane's route for a path, or undefined for one it does not serve. */
export function routeOf(path: string): LaneRoute | undefined {
  if (!path.startsWith(MANAGED_AGENTS_PATH_PREFIX)) {
    return undefined;
  }
  const [encodedId, events, stream, ...rest] = path.slice(MANAGED_AGENTS_PATH_PREFIX.length).split("/");
  if (encodedId === undefined || encodedId === "" || events !== "events" || rest.length > 0) {
    return undefined;
  }
  let sessionId: string;
  try {
    sessionId = decodeURIComponent(encodedId);
  } catch {
    return undefined;
  }
  if (stream === undefined) {
    return { kind: "events", sessionId };
  }
  return stream === "stream" ? { kind: "stream", sessionId } : undefined;
}

/**
 * The headers a lane call carries (module header): the caller's credential
 * as a bearer token where the server verifies credentials, and `origin`.
 */
export function forwardedHeaders(request: LaneRequest, authenticationRequired: boolean): Headers | LaneError {
  const headers = new Headers();
  const origin = headerOf(request, "origin");
  if (origin !== undefined) {
    headers.set("origin", origin);
  }
  if (!authenticationRequired) {
    return headers;
  }
  const authorization = headerOf(request, "authorization") ?? "";
  const apiKey = (headerOf(request, "x-api-key") ?? "").trim();
  if (apiKey === "") {
    if (authorization !== "") {
      headers.set("authorization", authorization);
    }
    return headers;
  }
  if (authorization !== "" && parseBearerToken(authorization) !== apiKey) {
    return laneError(
      401,
      "authentication_error",
      "the X-Api-Key and Authorization headers carry different credentials; send one",
    );
  }
  headers.set("authorization", `Bearer ${apiKey}`);
  return headers;
}

function headerOf(request: LaneRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value.join(", ") : value;
}

/**
 * A send's body, parsed as JSON, read up to the port's message cap. Past
 * the cap the body is refused and the rest is read and discarded (Node
 * drains an unread body once the answer is written), so the client reads
 * the 413 instead of a broken connection, which its SDK would retry.
 */
async function readJsonBody(request: LaneRequest): Promise<{ readonly value: unknown } | LaneError> {
  const tooLarge = (): LaneError =>
    laneError(413, "invalid_request_error", `the request body exceeds ${MAX_MESSAGE_BYTES} bytes`);
  if (Number(headerOf(request, "content-length") ?? 0) > MAX_MESSAGE_BYTES) {
    return tooLarge();
  }
  const body: Readable = request;
  const read = await new Promise<Buffer | "too-large">((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > MAX_MESSAGE_BYTES) {
        body.off("data", onData);
        resolve("too-large");
        return;
      }
      chunks.push(chunk);
    };
    body.on("data", onData);
    body.once("end", () => resolve(Buffer.concat(chunks)));
    body.once("error", reject);
    // A client that leaves mid-body never ends it; settle so nothing waits forever.
    body.once("close", () => reject(new Error("the client closed the request before its body ended")));
  });
  if (read === "too-large") {
    return tooLarge();
  }
  try {
    return { value: JSON.parse(read.toString("utf8")) as unknown };
  } catch {
    return laneError(400, "invalid_request_error", "the request body must be JSON");
  }
}

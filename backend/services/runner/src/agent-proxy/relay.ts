/**
 * One forwarded request: the agent host's call, re-addressed and
 * re-credentialed by a lane (`lanes.ts`), sent upstream, and the upstream's
 * answer streamed back unchanged.
 *
 * The lane is transparent by design: the host's SDK must parse the
 * provider's own response — its status, its error body, its server-sent
 * events or Bedrock's binary event stream — exactly as it would have
 * talking to the provider itself, so the host's error wording and retry
 * behaviour stay what they were. So the request keeps every header but
 * the credential ones and the hop-by-hop ones, and the response keeps
 * every header but the hop-by-hop ones. `accept-encoding` is pinned to
 * `identity`, so the bytes relayed are the bytes the headers describe.
 *
 * The request body is buffered (a signer needs it whole; a model request
 * is a JSON document) under {@link MAX_REQUEST_BYTES}; the response is
 * streamed as it arrives, at the pace the host reads it. A host that disconnects aborts the upstream
 * request; an upstream that fails mid-stream destroys the host's socket,
 * so a cut-off answer never reads as a complete one.
 */

import { request as httpRequest, type IncomingHttpHeaders, type OutgoingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Readable } from "node:stream";

/** The largest request body a lane accepts: the agent host's own message cap. */
export const MAX_REQUEST_BYTES = 64 * 1024 * 1024;

/** Headers that describe one connection, never the message (RFC 9110 §7.6.1), plus the ones the relay recomputes. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "accept-encoding",
]);

/** The host's credential headers: a lane replaces them, and the stigmer scope headers are the proxy's to read. */
const HOST_CREDENTIAL = new Set(["authorization", "x-api-key"]);

export class RequestTooLargeError extends Error {}

/** Read a request body whole, refusing one larger than `limit`. */
export function readBody(req: Readable, limit = MAX_REQUEST_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new RequestTooLargeError(`request body exceeds ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * The scope header a forwarding lane passes to the platform's proxy: the
 * execution id, which the local proxy has checked names a live turn
 * (`server.ts`). Any other `x-stigmer-*` header the host sets is its own
 * claim, unchecked here, and the platform authorizes and meters by those.
 */
const CHECKED_SCOPE = "x-stigmer-execution-id";

/**
 * The host's request headers a lane forwards: everything but the
 * connection's, the host's credential, and the `x-stigmer-*` scope headers,
 * which only the platform's proxy reads; with `keepScope`, the checked
 * execution id still passes.
 */
export function forwardableHeaders(headers: IncomingHttpHeaders, keepScope: boolean): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || name.startsWith(":") || HOP_BY_HOP.has(name) || HOST_CREDENTIAL.has(name)) continue;
    if (name.startsWith("x-stigmer-") && !(keepScope && name === CHECKED_SCOPE)) continue;
    out[name] = value;
  }
  return out;
}

export interface Upstream {
  readonly url: URL;
  readonly method: string;
  readonly headers: Record<string, string | string[]>;
  readonly body: Buffer;
}

/**
 * A response a lane answers on: HTTP/1.1's, or the HTTP/2 compatibility
 * API's (`cursor-lane.ts`) — what both have that the lanes use.
 */
export interface RelayResponse extends NodeJS.WritableStream {
  readonly headersSent: boolean;
  readonly writableFinished: boolean;
  writeHead(statusCode: number, headers?: OutgoingHttpHeaders): this;
  destroy(error?: Error): this;
}

/** Send `upstream` and stream its answer to `res`. Resolves when the answer has ended or failed. */
export function relay(res: RelayResponse, upstream: Upstream): Promise<void> {
  return new Promise((resolve) => {
    const outgoing = send(upstream);
    const abortUpstream = (): void => {
      if (!res.writableFinished) outgoing.destroy();
    };
    res.on("close", abortUpstream);
    outgoing.on("response", (answer) => {
      const headers: Record<string, string | string[]> = {};
      for (const [name, value] of Object.entries(answer.headers)) {
        if (value !== undefined && !HOP_BY_HOP.has(name)) headers[name] = value;
      }
      res.writeHead(answer.statusCode ?? 502, headers);
      // Piped, so a host that reads slowly slows the provider instead of the
      // runner buffering the stream.
      answer.pipe(res);
      answer.on("end", () => resolve());
      answer.on("error", () => {
        res.destroy();
        resolve();
      });
    });
    // Only a request that never got an answer fails here; a failure once the
    // answer has started is the answer's own `error` above.
    outgoing.on("error", (err) => {
      res.off("close", abortUpstream);
      replyError(res, 502, `the upstream could not be reached: ${err.message}`);
      resolve();
    });
    outgoing.end(upstream.body);
  });
}

/** Send `upstream` and read its whole answer: for a lane that rewrites the answer (`cursor-lane.ts`'s exchange). */
export function requestWhole(upstream: Upstream): Promise<{ readonly status: number; readonly headers: Record<string, string | string[]>; readonly body: Buffer }> {
  return new Promise((resolve, reject) => {
    const outgoing = send(upstream);
    outgoing.on("response", (answer) => {
      const headers: Record<string, string | string[]> = {};
      for (const [name, value] of Object.entries(answer.headers)) {
        if (value !== undefined && !HOP_BY_HOP.has(name)) headers[name] = value;
      }
      readBody(answer).then((body) => resolve({ status: answer.statusCode ?? 502, headers, body }), reject);
    });
    outgoing.on("error", (err) => reject(new Error(`the upstream could not be reached: ${err.message}`)));
    outgoing.end(upstream.body);
  });
}

function send(upstream: Upstream): ReturnType<typeof httpRequest> {
  const request = upstream.url.protocol === "https:" ? httpsRequest : httpRequest;
  return request(upstream.url, {
    method: upstream.method,
    headers: { ...upstream.headers, "accept-encoding": "identity", "content-length": String(upstream.body.length) },
  });
}

/**
 * A refusal or a lane failure, in the shape both provider SDKs parse as an
 * API error (`{"type":"error","error":{...}}`), so the host's classifier
 * reads its message.
 */
export function replyError(res: RelayResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body = JSON.stringify({ type: "error", error: { type: status === 401 ? "authentication_error" : "api_error", message } });
  res.writeHead(status, { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) });
  res.end(body);
}

/** The token of an `Authorization: Bearer <token>` header, read without a backtracking pattern (the header is the host's to send). */
export function bearerOf(header: string | undefined): string | undefined {
  if (header === undefined || !/^bearer\s/i.test(header)) return undefined;
  const token = header.slice("bearer".length).trim();
  return token.length > 0 ? token : undefined;
}

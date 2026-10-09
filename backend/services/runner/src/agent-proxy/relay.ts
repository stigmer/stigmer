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
 * streamed as it arrives. A host that disconnects aborts the upstream
 * request; an upstream that fails mid-stream destroys the host's socket,
 * so a cut-off answer never reads as a complete one.
 */

import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";

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
export function readBody(req: IncomingMessage, limit = MAX_REQUEST_BYTES): Promise<Buffer> {
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
 * The host's request headers a lane forwards: everything but the
 * connection's, the host's credential, and (unless `keepScope`) the
 * `x-stigmer-*` scope headers, which only the platform's proxy reads.
 */
export function forwardableHeaders(headers: IncomingHttpHeaders, keepScope: boolean): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP.has(name) || HOST_CREDENTIAL.has(name)) continue;
    if (!keepScope && name.startsWith("x-stigmer-")) continue;
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

/** Send `upstream` and stream its answer to `res`. Resolves when the answer has ended or failed. */
export function relay(req: IncomingMessage, res: ServerResponse, upstream: Upstream): Promise<void> {
  return new Promise((resolve) => {
    const send = upstream.url.protocol === "https:" ? httpsRequest : httpRequest;
    const outgoing = send(upstream.url, {
      method: upstream.method,
      headers: { ...upstream.headers, "accept-encoding": "identity", "content-length": String(upstream.body.length) },
    });
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
      answer.on("data", (chunk: Buffer) => res.write(chunk));
      answer.on("end", () => {
        res.end();
        resolve();
      });
      answer.on("error", () => {
        res.destroy();
        resolve();
      });
    });
    outgoing.on("error", (err) => {
      res.off("close", abortUpstream);
      if (res.headersSent) res.destroy();
      else replyError(res, 502, `the upstream could not be reached: ${err.message}`);
      resolve();
    });
    outgoing.end(upstream.body);
  });
}

/**
 * A refusal or a lane failure, in the shape both provider SDKs parse as an
 * API error (`{"type":"error","error":{...}}`), so the host's classifier
 * reads its message.
 */
export function replyError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body = JSON.stringify({ type: "error", error: { type: status === 401 ? "authentication_error" : "api_error", message } });
  res.writeHead(status, { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) });
  res.end(body);
}

// Drives the Cursor BiDi proxy's HANDSHAKE over raw HTTP/2 (h2c).
// Domain: conformance support (proxy suites, E1).
//
// The bidi proxy is a Netty h2c listener that authenticates a Connect stream
// from its headers (x-stigmer-auth, else authorization / x-api-key),
// authorizes /agent.v1.* paths against the execution scope, and only then
// relays to Cursor over TLS. The relay cannot be driven hermetically (ruling
// Q4 of E1 — its upstream is api2.cursor.sh), but the handshake's three
// refusals can, and they are the contract runners hit first: a missing token
// is an RST_STREAM(REFUSED_STREAM); a token nothing claims is a Connect error
// 401 / code 16 "Authentication failed"; an FGA denial is 403 / code 7
// "Access denied" — both with application/grpc headers, never a raw reset.
//
// node:http2 is used directly rather than connect-node because the suite has
// no descriptor for Cursor's AgentService and needs to observe the raw frame
// outcome (a reset vs. headers), which a Connect client would fold into one
// error.
import { connect, constants, type ClientHttp2Session } from "node:http2";

export interface BidiHandshakeOutcome {
  // "headers": the server answered with HTTP headers (status, grpc-status,
  // grpc-message); "reset": the stream was reset with the given HTTP/2 error
  // code before any headers arrived.
  readonly kind: "headers" | "reset";
  readonly status?: number;
  readonly grpcStatus?: number;
  readonly grpcMessage?: string;
  readonly contentType?: string;
  readonly rstCode?: number;
}

export interface BidiHandshakeOptions {
  readonly path?: string;
  readonly headers?: Record<string, string>;
  readonly timeoutMs?: number;
}

export const HTTP2_REFUSED_STREAM = constants.NGHTTP2_REFUSED_STREAM;

// Opens one Connect stream on the bidi listener with the given headers, sends
// nothing, and reports how the proxy answered the handshake.
export async function bidiHandshake(baseUrl: string, options: BidiHandshakeOptions = {}): Promise<BidiHandshakeOutcome> {
  const session: ClientHttp2Session = connect(baseUrl);
  const path = options.path ?? "/agent.v1.AgentService/Run";
  const timeoutMs = options.timeoutMs ?? 10_000;
  try {
    return await new Promise<BidiHandshakeOutcome>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`bidi handshake on ${path} produced no outcome within ${timeoutMs}ms`)), timeoutMs);
      timer.unref();
      session.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      const stream = session.request({
        ":method": "POST",
        ":path": path,
        "content-type": "application/connect+proto",
        ...options.headers,
      });
      stream.once("response", (headers) => {
        clearTimeout(timer);
        const status = Number(headers[":status"]);
        const grpcStatus = headers["grpc-status"];
        resolve({
          kind: "headers",
          status,
          grpcStatus: grpcStatus === undefined ? undefined : Number(grpcStatus),
          grpcMessage: typeof headers["grpc-message"] === "string" ? decodeURIComponent(headers["grpc-message"]) : undefined,
          contentType: typeof headers["content-type"] === "string" ? headers["content-type"] : undefined,
        });
        stream.close();
      });
      stream.once("error", (err: NodeJS.ErrnoException & { code?: string }) => {
        // An RST_STREAM surfaces as ERR_HTTP2_STREAM_ERROR with rstCode set.
        clearTimeout(timer);
        const rstCode = (stream as unknown as { rstCode?: number }).rstCode;
        if (rstCode !== undefined) {
          resolve({ kind: "reset", rstCode });
        } else {
          reject(err);
        }
      });
      // Half-close our side: the handshake must be decided on headers alone.
      stream.end();
    });
  } finally {
    session.close();
  }
}

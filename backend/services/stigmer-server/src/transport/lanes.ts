/**
 * Shared request/response types for the unified port's lanes. The demux
 * routes each connection to the HTTP/1.1 or HTTP/2 server, and BOTH run the
 * same lane router — so every lane handler must accept both protocol
 * stacks' shapes (the members used — headers, method, url, setHeader,
 * statusCode, end — behave identically on both).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Http2ServerRequest, Http2ServerResponse } from "node:http2";

export type LaneRequest = IncomingMessage | Http2ServerRequest;
export type LaneResponse = ServerResponse | Http2ServerResponse;

export type LaneHandler = (
  request: LaneRequest,
  response: LaneResponse,
) => void;

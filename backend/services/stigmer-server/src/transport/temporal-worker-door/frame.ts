/**
 * Unary gRPC over HTTP/2, the part the Temporal worker lane needs and no
 * more: one length-prefixed message in, one out, the `grpc-timeout`
 * deadline, and the status in trailers. The server's Connect adapter is not
 * used here because Temporal's API is protobufjs (`@temporalio/proto`) and
 * the adapter serves the server's own protobuf-es services; generating
 * Temporal's API into the server's build would put a second copy of a
 * vendor contract in the tree.
 *
 * The frame (the gRPC wire format, "Length-Prefixed-Message"): one flag
 * byte (bit 0: compressed), a four-byte big-endian length, the message. A
 * compressed message is refused: the server advertises no encoding, and
 * the Temporal SDK's core sends none unless asked.
 */
import type { Http2ServerRequest, Http2ServerResponse } from "node:http2";

/** The gRPC status codes this lane answers with (the canonical numbers). */
export const GrpcCode = {
  OK: 0,
  CANCELLED: 1,
  INVALID_ARGUMENT: 3,
  DEADLINE_EXCEEDED: 4,
  PERMISSION_DENIED: 7,
  RESOURCE_EXHAUSTED: 8,
  UNIMPLEMENTED: 12,
  INTERNAL: 13,
  UNAVAILABLE: 14,
  UNAUTHENTICATED: 16,
} as const;

export type GrpcCodeNumber = (typeof GrpcCode)[keyof typeof GrpcCode];

/** A request's message, or the status to answer instead. */
export type UnaryRead =
  | { readonly ok: true; readonly message: Uint8Array }
  | { readonly ok: false; readonly code: GrpcCodeNumber; readonly reason: "malformed" | "compressed" | "tooLarge" };

const PREFIX_BYTES = 5;

/** Reads the request body whole and unframes its one message. */
export async function readUnaryMessage(
  request: Http2ServerRequest,
  maxMessageBytes: number,
): Promise<UnaryRead> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const piece = chunk as Buffer;
    total += piece.length;
    if (total > maxMessageBytes + PREFIX_BYTES) {
      return { ok: false, code: GrpcCode.RESOURCE_EXHAUSTED, reason: "tooLarge" };
    }
    chunks.push(piece);
  }
  return unframe(Buffer.concat(chunks, total));
}

/** The one message a request body carries (exported for its test). */
export function unframe(body: Buffer): UnaryRead {
  if (body.length < PREFIX_BYTES) {
    return { ok: false, code: GrpcCode.INTERNAL, reason: "malformed" };
  }
  if ((body[0]! & 1) === 1) {
    return { ok: false, code: GrpcCode.UNIMPLEMENTED, reason: "compressed" };
  }
  const length = body.readUInt32BE(1);
  if (body.length !== PREFIX_BYTES + length) {
    return { ok: false, code: GrpcCode.INTERNAL, reason: "malformed" };
  }
  return { ok: true, message: body.subarray(PREFIX_BYTES) };
}

/** The message framed for the wire (uncompressed). */
export function frame(message: Uint8Array): Buffer {
  const prefix = Buffer.alloc(PREFIX_BYTES);
  prefix.writeUInt32BE(message.length, 1);
  return Buffer.concat([prefix, message]);
}

/** One gRPC answer: an optional message, then the status in trailers. */
export interface GrpcAnswer {
  readonly code: number;
  readonly message?: Uint8Array;
  readonly text?: string;
  /** `grpc-status-details-bin` as Temporal sent it, relayed byte for byte. */
  readonly details?: Uint8Array;
}

export function writeGrpcAnswer(response: Http2ServerResponse, answer: GrpcAnswer): void {
  if (response.headersSent || response.destroyed) {
    return;
  }
  response.writeHead(200, { "content-type": "application/grpc" });
  if (answer.message !== undefined) {
    response.write(frame(answer.message));
  }
  const trailers: Record<string, string> = { "grpc-status": String(answer.code) };
  if (answer.text !== undefined && answer.text !== "") {
    trailers["grpc-message"] = percentEncode(answer.text);
  }
  if (answer.details !== undefined && answer.details.length > 0) {
    trailers["grpc-status-details-bin"] = Buffer.from(answer.details).toString("base64").replace(/=+$/, "");
  }
  response.addTrailers(trailers);
  response.end();
}

/** gRPC's `grpc-message` encoding: printable ASCII but `%` as is, the rest as UTF-8 percent escapes. */
export function percentEncode(text: string): string {
  let out = "";
  for (const byte of Buffer.from(text, "utf8")) {
    out +=
      byte >= 0x20 && byte <= 0x7e && byte !== 0x25
        ? String.fromCharCode(byte)
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

const TIMEOUT_UNIT_MS: Readonly<Record<string, number>> = {
  H: 3_600_000,
  M: 60_000,
  S: 1_000,
  m: 1,
  u: 0.001,
  n: 0.000001,
};

/** The caller's deadline in milliseconds from now, or undefined for none (or a value gRPC does not allow). */
export function grpcTimeoutMs(header: string | string[] | undefined): number | undefined {
  if (typeof header !== "string") {
    return undefined;
  }
  const match = /^(\d{1,8})([HMSmun])$/.exec(header);
  if (match === null) {
    return undefined;
  }
  return Number(match[1]) * TIMEOUT_UNIT_MS[match[2]!]!;
}

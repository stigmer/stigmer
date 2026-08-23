/**
 * Cleartext protocol demux for the unified port — the TS equivalent of Go's
 * h2c wrapper (backend/libs/go/grpc/server.go, StartHTTP).
 *
 * Why this exists: Go's h2c handler transparently serves HTTP/2
 * prior-knowledge AND HTTP/1.1 on one cleartext socket. Node's cleartext
 * `http2.createServer` does not fall back to HTTP/1.1 (its `allowHTTP1`
 * option is TLS/ALPN-only), and browsers only speak HTTP/1.1 on cleartext.
 * The port's clients therefore split by protocol: native gRPC (runner,
 * conformance harness) opens HTTP/2 with prior knowledge; browser gRPC-Web,
 * Connect-over-1.1, and the REST lanes speak HTTP/1.1.
 *
 * Mechanism: every HTTP/2 prior-knowledge connection MUST begin with the
 * 24-byte client connection preface (RFC 9113 §3.4). We peek the first bytes
 * of each socket, decide the moment the bytes diverge from (or complete) the
 * preface, and hand the socket to the matching protocol server. HTTP/1.1
 * requests diverge at byte 0 ("GET", "POST", "OPTI"…), so the common browser
 * path decides on the first chunk.
 *
 * The two handoffs are deliberately different (spike SP-A finding,
 * 2026-08-23): Node's HTTP/1.1 parser reads the socket as a JS stream, so
 * `unshift` replays the peeked bytes for it. Node's HTTP/2 core instead
 * consumes the socket's NATIVE handle — bytes unshifted into the JS stream
 * buffer never reach it, and the session fails with "bad client magic". The
 * h2 lane therefore hands over a small replay Duplex (peeked bytes first,
 * then the live socket), which http2 accepts through its JSStreamSocket
 * path. Only HTTP/2 connections pay the wrapper; they are few and
 * long-lived (the runner and harness hold channels open), so the per-byte
 * JS-stream hop amortizes and HTTP/1.1 traffic stays on the raw socket.
 *
 * The CLI's readiness gate is a bare TCP probe (connect + close, no data —
 * client-apps/cli/src/local/daemon/components.ts serverGate). Sockets that
 * close before a decision are simply released; they must never log errors
 * or crash the process.
 *
 * Proven by spike SP-A (D2 spike register): the co-located test exercises
 * all four verified client transports against this demux.
 */
import type { Server as Http1Server } from "node:http";
import type { Http2Server } from "node:http2";
import { createServer, type Server, type Socket } from "node:net";
import { Duplex } from "node:stream";

/**
 * The HTTP/2 client connection preface (RFC 9113 §3.4). Byte-exact; a
 * cleartext client either opens with these 24 bytes or it is not speaking
 * HTTP/2 prior-knowledge.
 */
export const HTTP2_CONNECTION_PREFACE = Buffer.from(
  "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n",
  "latin1",
);

export interface DemuxTargets {
  /** Serves browser gRPC-Web, Connect over 1.1, and the REST lanes. */
  http1: Http1Server;
  /** Serves native gRPC and the HTTP/2 flavors of Connect/gRPC-Web. */
  http2: Http2Server;
}

/**
 * Creates the TCP front server that peeks each connection's first bytes and
 * routes the socket to the HTTP/1.1 or HTTP/2 server. The returned server is
 * the one that binds the unified port; the protocol servers never listen
 * themselves.
 */
export function createProtocolDemuxServer(targets: DemuxTargets): Server {
  return createServer({ noDelay: true }, (socket) => {
    routeByPreface(socket, targets);
  });
}

function routeByPreface(socket: Socket, targets: DemuxTargets): void {
  const peeked: Buffer[] = [];
  let peekedLength = 0;

  const cleanup = (): void => {
    socket.removeListener("data", onData);
    socket.removeListener("error", onPeekError);
    socket.removeListener("close", cleanup);
  };

  // A socket that errors or closes mid-peek (TCP probes, port scanners,
  // clients giving up) is released without routing — silently, because the
  // readiness gate produces one of these on every daemon boot.
  const onPeekError = (): void => {
    cleanup();
    socket.destroy();
  };

  const onData = (chunk: Buffer): void => {
    peeked.push(chunk);
    peekedLength += chunk.length;

    const seen = Buffer.concat(peeked, Math.min(peekedLength, HTTP2_CONNECTION_PREFACE.length));
    const comparable = seen.subarray(0, Math.min(seen.length, HTTP2_CONNECTION_PREFACE.length));

    if (!HTTP2_CONNECTION_PREFACE.subarray(0, comparable.length).equals(comparable)) {
      handoffHttp1();
      return;
    }
    if (peekedLength >= HTTP2_CONNECTION_PREFACE.length) {
      handoffHttp2();
      return;
    }
    // A strict prefix of the preface: keep peeking until it completes or
    // diverges. (No real client fragments 24 bytes, but TCP permits it.)
  };

  function handoffHttp1(): void {
    cleanup();
    socket.pause();
    // The HTTP/1.1 parser reads the JS stream, so unshift replays the
    // peeked bytes and the server parses the connection from byte 0.
    socket.unshift(Buffer.concat(peeked, peekedLength));
    targets.http1.emit("connection", socket);
    socket.resume();
  }

  function handoffHttp2(): void {
    cleanup();
    socket.pause();
    const replay = createReplayDuplex(socket, Buffer.concat(peeked, peekedLength));
    targets.http2.emit("connection", replay);
  }

  socket.on("data", onData);
  socket.on("error", onPeekError);
  socket.on("close", cleanup);
}

/**
 * A Duplex that delivers `head` before the socket's live bytes and forwards
 * writes/shutdown to the socket. Required for the h2 handoff only: http2
 * consumes the native socket handle directly, so JS-level `unshift` cannot
 * replay peeked bytes for it (verified in spike SP-A). Backpressure maps
 * both ways: a full Duplex buffer pauses the socket; http2 reads resume it.
 */
function createReplayDuplex(socket: Socket, head: Buffer): Duplex {
  const replay = new Duplex({
    read(): void {
      socket.resume();
    },
    write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
      socket.write(chunk, encoding, callback);
    },
    final(callback: (error?: Error | null) => void): void {
      socket.end(callback);
    },
    destroy(error: Error | null, callback: (error?: Error | null) => void): void {
      socket.destroy();
      callback(error);
    },
  });

  socket.on("data", (chunk) => {
    if (!replay.push(chunk)) {
      socket.pause();
    }
  });
  socket.on("end", () => {
    replay.push(null);
  });
  socket.on("error", (error) => {
    replay.destroy(error);
  });

  replay.push(head);
  return replay;
}

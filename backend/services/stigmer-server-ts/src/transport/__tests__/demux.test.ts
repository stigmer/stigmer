/**
 * Spike SP-A (D2 spike register): the cleartext preface demux serves all
 * four verified client transports on ONE port. These tests pin the demux
 * against the exact transport constructors the real clients use:
 *
 *   1. native gRPC over h2c        — runner (stigmer-client.ts) and the
 *                                    conformance harness (harness/clients.ts)
 *   2. gRPC-Web over HTTP/1.1      — browser SDK (sdk/typescript/transport.ts)
 *   3. Connect over HTTP/1.1       — SDK `transport: "connect"` (additive
 *                                    delta 2, ratified 2026-08-22)
 *   4. Connect over HTTP/2         — same protocol on the h2 path
 *
 * Plus the two socket shapes that must never wedge the port: the CLI
 * readiness gate's bare TCP probe (connect + close, no bytes) and a
 * byte-fragmented preface (TCP permits 24 bytes in two segments).
 *
 * A failure here is a protocol surprise (collaboration protocol): the
 * fallback ladder in D2's spike register is an OWNER decision.
 */
import { createClient, type Transport } from "@connectrpc/connect";
import {
  createConnectTransport,
  createGrpcTransport,
  createGrpcWebTransport,
} from "@connectrpc/connect-node";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  Health,
  HealthCheckResponse_ServingStatus,
} from "@stigmer/protos/grpc/health/v1/health_pb";
import { createServer as createHttp1Server } from "node:http";
import { createServer as createHttp2Server } from "node:http2";
import { connect as netConnect, type Server, type Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createProtocolDemuxServer,
  HTTP2_CONNECTION_PREFACE,
} from "../demux.js";

let demux: Server;
let baseUrl: string;
let port: number;
// gRPC clients hold their h2 sessions open, so a bare server.close() would
// wait forever; teardown destroys whatever the tests left connected.
const liveSockets = new Set<Socket>();

beforeAll(async () => {
  const handler = connectNodeAdapter({
    routes: (router) => {
      router.service(Health, {
        check: () => ({ status: HealthCheckResponse_ServingStatus.SERVING }),
        list: () => ({ statuses: {} }),
        // The spike never calls watch; an empty stream satisfies the type.
        watch: async function* () {},
      });
    },
  });

  demux = createProtocolDemuxServer({
    http1: createHttp1Server(handler),
    http2: createHttp2Server(handler),
  });

  demux.on("connection", (socket: Socket) => {
    liveSockets.add(socket);
    socket.on("close", () => liveSockets.delete(socket));
  });

  port = await new Promise<number>((resolve, reject) => {
    demux.once("error", reject);
    demux.listen(0, "127.0.0.1", () => {
      const address = demux.address();
      if (address === null || typeof address === "string") {
        reject(new Error("demux bound without a TCP address"));
        return;
      }
      resolve(address.port);
    });
  });
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  const closed = new Promise<void>((resolve) => demux.close(() => resolve()));
  for (const socket of liveSockets) {
    socket.destroy();
  }
  await closed;
});

async function checkHealth(
  transport: Transport,
): Promise<HealthCheckResponse_ServingStatus> {
  const client = createClient(Health, transport);
  const response = await client.check({});
  return response.status;
}

describe("SP-A: the preface demux serves all four verified client transports", () => {
  it("serves native gRPC over h2c (runner / conformance harness shape)", async () => {
    const status = await checkHealth(createGrpcTransport({ baseUrl }));
    expect(status).toBe(HealthCheckResponse_ServingStatus.SERVING);
  });

  it("serves gRPC-Web over HTTP/1.1 (browser SDK shape)", async () => {
    const status = await checkHealth(
      createGrpcWebTransport({ baseUrl, httpVersion: "1.1" }),
    );
    expect(status).toBe(HealthCheckResponse_ServingStatus.SERVING);
  });

  it("serves the Connect protocol over HTTP/1.1 (SDK connect option)", async () => {
    const status = await checkHealth(
      createConnectTransport({ baseUrl, httpVersion: "1.1" }),
    );
    expect(status).toBe(HealthCheckResponse_ServingStatus.SERVING);
  });

  it("serves the Connect protocol over HTTP/2", async () => {
    const status = await checkHealth(
      createConnectTransport({ baseUrl, httpVersion: "2" }),
    );
    expect(status).toBe(HealthCheckResponse_ServingStatus.SERVING);
  });
});

describe("SP-A: socket shapes that must not wedge the port", () => {
  it("survives the CLI readiness gate's bare TCP probe (connect, no bytes, close)", async () => {
    await new Promise<void>((resolve, reject) => {
      const probe = netConnect(port, "127.0.0.1", () => {
        probe.end();
      });
      probe.on("close", () => resolve());
      probe.on("error", reject);
    });

    // The port still serves after the probe: the exact sequence the daemon
    // performs on every boot (probe, then real gRPC traffic).
    const status = await checkHealth(createGrpcTransport({ baseUrl }));
    expect(status).toBe(HealthCheckResponse_ServingStatus.SERVING);
  });

  it("routes a byte-fragmented HTTP/2 preface to the h2 server", async () => {
    // Deliver the preface in two TCP segments with a flush gap; the demux
    // must keep peeking across segments rather than misrouting a strict
    // preface prefix to HTTP/1.1.
    //
    // The assertion demands a PING ACK — not merely a SETTINGS frame. An h2
    // server emits its SETTINGS before parsing the client preface (spike
    // SP-A observed exactly that on a session that then died on "bad client
    // magic"), so SETTINGS proves nothing about the replay path. A PING is
    // only acknowledged by a session that accepted the preface and is
    // processing client frames.
    const socket = netConnect(port, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", reject);
    });

    socket.write(HTTP2_CONNECTION_PREFACE.subarray(0, 10));
    await new Promise((resolve) => setTimeout(resolve, 50));
    socket.write(HTTP2_CONNECTION_PREFACE.subarray(10));
    // Client SETTINGS (empty) — required before other frames — then PING.
    socket.write(
      Buffer.from([0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00]),
    );
    const pingPayload = Buffer.from("spike-a!", "latin1");
    socket.write(
      Buffer.concat([
        Buffer.from([0x00, 0x00, 0x08, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00]),
        pingPayload,
      ]),
    );

    const sawPingAck = await new Promise<boolean>((resolve, reject) => {
      let received = Buffer.alloc(0);
      const timer = setTimeout(
        () => reject(new Error("no PING ACK from the h2 server within 5s")),
        5_000,
      );
      socket.on("data", (chunk) => {
        received = Buffer.concat([received, chunk]);
        // Walk complete 9-byte-header frames looking for PING (0x6) + ACK (0x1).
        let offset = 0;
        while (received.length - offset >= 9) {
          const length = received.readUIntBE(offset, 3);
          const type = received[offset + 3];
          const flags = received[offset + 4];
          if (received.length - offset < 9 + length) {
            break;
          }
          if (type === 0x6 && (flags & 0x1) === 0x1) {
            clearTimeout(timer);
            resolve(true);
            return;
          }
          offset += 9 + length;
        }
      });
      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    socket.destroy();

    expect(
      sawPingAck,
      "h2 session accepted the replayed preface and ACKed the ping",
    ).toBe(true);
  });
});

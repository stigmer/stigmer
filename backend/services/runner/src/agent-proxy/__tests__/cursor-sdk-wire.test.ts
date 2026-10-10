/**
 * The Cursor wire end to end with the real SDK: `@cursor/sdk` in a process
 * of its own, as the agent host runs it (`__test-utils__/cursor-sdk-wire-child.ts`),
 * against the real local proxy (`agent-proxy/server.ts`, `cursor-lane.ts`),
 * against a fake of Cursor that speaks both HTTP/1.1 and HTTP/2 on one port
 * as Cursor's own hosts do. Every other Cursor test doubles the SDK; this one
 * proves what only the SDK itself can.
 *
 * Pinned:
 *  - the SDK trusts the lane through `NODE_EXTRA_CA_CERTS` alone, and opens
 *    its agent run on it as an HTTP/2 stream;
 *  - every key exchange reaches Cursor with the operator's key, every call
 *    after it with the real access token, and nothing Cursor receives
 *    carries the host's token;
 *  - Cursor's answer on the stream comes back to the SDK;
 *  - the SDK leaves certificate checks on in the host (it turns them off
 *    for a backend URL that reads as localhost or 127.0.0.1).
 */

import { spawn } from "node:child_process";
import { createServer as createHttp1Server, type IncomingHttpHeaders } from "node:http";
import { createServer as createH2cServer, type ServerHttp2Stream } from "node:http2";
import { createServer as createNetServer, type AddressInfo, type Server as NetServer } from "node:net";
import { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { testConfig } from "../../__test-utils__/config-fixture.js";
import { writeTrustedCertificates } from "../../agent-host/hosting.js";
import { AgentProxy } from "../server.js";

const HOST_TOKEN = "host-token-sdk-wire";
const OPERATOR_KEY = "crsr_operator_sdk_wire";
const EXECUTION = "aex-sdk-wire";
const REAL_TOKEN = `real.${Buffer.from(JSON.stringify({ exp: 2_000_000_000 })).toString("base64url")}.signature`;
const CHILD = fileURLToPath(new URL("../../__test-utils__/cursor-sdk-wire-child.ts", import.meta.url));

interface Seen {
  readonly protocol: "http/1.1" | "h2";
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
}

/** Cursor, faked: the exchange, the model list, the side calls, and an agent run it ends with an error of its own. */
function fakeCursor(seen: Seen[]): NetServer {
  const http1 = createHttp1Server((req, res) => {
    req.resume();
    req.on("end", () => {
      seen.push({ protocol: "http/1.1", path: req.url ?? "", headers: req.headers });
      const json = (status: number, body: unknown): void => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.url === "/auth/exchange_user_api_key") json(200, { accessToken: REAL_TOKEN });
      else if (req.url === "/v1/models") json(200, { items: [{ id: "composer-2.5", displayName: "Composer" }] });
      else json(200, {});
    });
  });
  const h2 = createH2cServer();
  h2.on("stream", (stream: ServerHttp2Stream, headers) => {
    seen.push({ protocol: "h2", path: String(headers[":path"]), headers });
    stream.on("data", () => {});
    const body = Buffer.from(JSON.stringify({ error: { code: "unavailable", message: "the fake Cursor ends the run" } }));
    const frame = Buffer.alloc(5 + body.length);
    frame[0] = 2; // the Connect end-of-stream flag
    frame.writeUInt32BE(body.length, 1);
    body.copy(frame, 5);
    stream.respond({ ":status": 200, "content-type": String(headers["content-type"] ?? "application/connect+proto") });
    stream.end(frame);
  });
  // One port for both, told apart by the HTTP/2 preface. The HTTP/2 server
  // reads the socket's own handle, so it is handed a stream that replays the
  // first chunk instead of the socket the chunk was taken from.
  return createNetServer((socket) => {
    socket.once("data", (first: Buffer) => {
      if (first.toString("latin1").startsWith("PRI * HTTP/2.0")) {
        const bridge = new Duplex({
          read() {},
          write(chunk: Buffer, _encoding, done) {
            socket.write(chunk, done);
          },
          final(done) {
            socket.end();
            done();
          },
        });
        bridge.push(first);
        socket.on("data", (chunk: Buffer) => bridge.push(chunk));
        socket.on("end", () => bridge.push(null));
        socket.on("close", () => bridge.destroy());
        h2.emit("connection", bridge);
      } else {
        socket.pause();
        socket.unshift(first);
        http1.emit("connection", socket);
        socket.resume();
      }
    });
  });
}

const seen: Seen[] = [];
const cursor = fakeCursor(seen);
let proxy: AgentProxy;
let trust: { readonly file: string; remove(): void };
const savedBackend = process.env.CURSOR_BACKEND_URL;

beforeAll(async () => {
  await new Promise<void>((resolve) => cursor.listen(0, "127.0.0.1", resolve));
  process.env.CURSOR_BACKEND_URL = `http://127.0.0.1:${(cursor.address() as AddressInfo).port}`;
  proxy = await AgentProxy.start(testConfig({ proxyEndpoint: null, cursorApiKey: OPERATOR_KEY }));
  proxy.authorizeHost(HOST_TOKEN);
  proxy.openTurn({ executionId: EXECUTION, threadId: "thread-ses-sdk-wire" });
  trust = writeTrustedCertificates(proxy.cursorCertificate, undefined);
});

afterAll(async () => {
  await proxy.close();
  trust.remove();
  await new Promise<void>((resolve) => cursor.close(() => resolve()));
  if (savedBackend === undefined) delete process.env.CURSOR_BACKEND_URL;
  else process.env.CURSOR_BACKEND_URL = savedBackend;
});

/** Run the SDK's side in its own process and read the line it reports. */
function runSdk(): Promise<{ readonly status: string; readonly error: string | null; readonly tlsRejectUnauthorized: string | null }> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_EXTRA_CA_CERTS: trust.file, CURSOR_BACKEND_URL: proxy.cursorEndpoint };
    delete env.NODE_TLS_REJECT_UNAUTHORIZED;
    const child = spawn(process.execPath, ["--import", "tsx", CHILD, proxy.cursorEndpoint, HOST_TOKEN, EXECUTION], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
    child.on("exit", () => {
      const line = out.split("\n").find((l) => l.startsWith("WIRE "));
      if (line === undefined) reject(new Error(`the SDK's process reported nothing:\n${out}\n${err}`));
      else resolve(JSON.parse(line.slice("WIRE ".length)) as never);
    });
  });
}

describe("the real Cursor SDK through the Cursor lane", () => {
  it("opens its agent run over HTTP/2 on the lane, Cursor sees the runner's credentials only, and Cursor's answer comes back", async () => {
    const result = await runSdk();

    expect(result).toEqual({ status: "error", error: "[unavailable] the fake Cursor ends the run", tlsRejectUnauthorized: null });

    const run = seen.find((s) => s.path === "/agent.v1.AgentService/Run");
    expect(run?.protocol, "the agent run is an HTTP/2 stream").toBe("h2");
    expect(run?.headers.authorization).toBe(`Bearer ${REAL_TOKEN}`);

    const exchanges = seen.filter((s) => s.path === "/auth/exchange_user_api_key");
    expect(exchanges.length).toBeGreaterThan(0);
    for (const exchange of exchanges) expect(exchange.headers.authorization).toBe(`Bearer ${OPERATOR_KEY}`);
    for (const call of seen.filter((s) => s.path.startsWith("/aiserver.v1.") || s.path.startsWith("/agent.v1."))) {
      expect(call.headers.authorization, call.path).toBe(`Bearer ${REAL_TOKEN}`);
    }
    expect(JSON.stringify(seen.map((s) => s.headers))).not.toContain(HOST_TOKEN);
  }, 60_000);
});

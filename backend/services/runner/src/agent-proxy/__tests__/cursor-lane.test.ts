/**
 * The local proxy's Cursor lane (`agent-proxy/cursor-lane.ts`), through the
 * real proxy (`agent-proxy/server.ts`) over TLS, against fakes of Cursor's
 * REST host (HTTP/1.1) and its Connect host (HTTP/2 without TLS, as the
 * platform's lane is behind its gateway).
 *
 * Pinned:
 *  - custody: the key exchange is made with the runner's credential, the
 *    host receives a stand-in that names the real token's expiry and no
 *    refresh token, and every Connect call swaps the stand-in back for the
 *    real token on its way out; a stand-in the lane does not hold (another
 *    host's, an expired one, one pushed out by newer ones) is
 *    unauthenticated;
 *  - the agent run is relayed as a bidirectional HTTP/2 stream, data both
 *    ways as it flows and the trailers after; a side call over HTTP/1.1 is
 *    relayed too;
 *  - bounds: REST needs the host's token, a live execution and a Cursor
 *    host; the agent run needs a live execution; side calls need only the
 *    stand-in; a path outside both is unknown;
 *  - terminate mode reaches Cursor with the operator's key and no scope
 *    header; forward mode reaches the platform's proxy with the runner's
 *    credential, the real token, and the execution id as its one scope
 *    header;
 *  - an exchange the upstream refuses, or answers without a token, comes
 *    back as it was; an upstream that cannot be reached is a 502 in the
 *    shape a Connect client reads;
 *  - a host that drops its connection mid-stream has its run cancelled at
 *    Cursor, and a drop mid-stream or mid-handshake leaves the lane serving.
 */

import { request as httpsRequest } from "node:https";
import { connect as tlsConnect } from "node:tls";
import { connect, createServer as createH2cServer, type Http2Server, type IncomingHttpHeaders, type ServerHttp2Stream } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { testConfig } from "../../__test-utils__/config-fixture.js";
import { FakeUpstream } from "../../__test-utils__/fake-upstream.js";
import type { Config } from "../../config.js";
import { AgentProxy } from "../server.js";

const HOST_TOKEN = "host-token-cursor-lane";
const RUNNER_TOKEN = "runner-proxy-token";
const OPERATOR_KEY = "crsr_operator_key";
const EXECUTION = "aex-cursor-live";
const EXP = Math.floor(Date.parse("2030-01-01T00:00:00Z") / 1000);
const REAL_TOKEN = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ exp: EXP, sub: "user" })).toString("base64url")}.signature`;
const EXCHANGE = "/v1/proxy/cursor/api2.cursor.sh/auth/exchange_user_api_key";
const RUN = "/agent.v1.AgentService/Run";

/** Cursor's Connect host: records each stream, echoes each chunk back as it arrives, ends with a trailer. */
class FakeConnectHost {
  readonly streams: { readonly path: string; readonly headers: IncomingHttpHeaders }[] = [];
  /** How each stream ended, by its reset code (0 for a clean end). */
  readonly closedCodes: number[] = [];
  /** Answer the headers, then reset the stream: an upstream that fails mid-answer. */
  resetAfterHeaders = false;
  url = "";
  private server: Http2Server | undefined;

  async start(): Promise<void> {
    this.server = createH2cServer();
    this.server.on("stream", (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => {
      this.streams.push({ path: String(headers[":path"]), headers });
      stream.on("close", () => this.closedCodes.push(stream.rstCode));
      if (this.resetAfterHeaders) {
        stream.respond({ ":status": 200, "content-type": "application/connect+proto" });
        stream.on("error", () => {});
        setTimeout(() => stream.destroy(new Error("Cursor broke mid-answer")), 20);
        return;
      }
      stream.respond({ ":status": 200, "content-type": "application/connect+proto" }, { waitForTrailers: true });
      stream.on("data", (chunk: Buffer) => stream.write(Buffer.concat([Buffer.from("echo:"), chunk])));
      stream.on("end", () => stream.end());
      stream.on("wantTrailers", () => stream.sendTrailers({ "x-upstream-trailer": "done" }));
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}

const rest = new FakeUpstream();
const connectHost = new FakeConnectHost();
const saved = new Map<string, string | undefined>();
let proxy: AgentProxy;
let closeTurn: () => void;

function setEnv(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

async function startProxy(overrides: Partial<Config> = {}): Promise<void> {
  proxy = await AgentProxy.start(testConfig({ proxyEndpoint: null, cursorApiKey: OPERATOR_KEY, ...overrides }));
  proxy.authorizeHost(HOST_TOKEN);
  closeTurn = proxy.openTurn({ executionId: EXECUTION, threadId: "thread-ses-cursor" });
}

/** An HTTP/1.1 call to the lane over TLS, trusting its certificate. */
function call(path: string, headers: Record<string, string>, body = "{}"): Promise<{ readonly status: number; readonly body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(`${proxy.cursorEndpoint}${path}`, { method: "POST", headers, ca: proxy.cursorCertificate }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function exchange(): Promise<string> {
  rest.answer = { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: REAL_TOKEN, refreshToken: "refresh-me" }) };
  const answer = await call(EXCHANGE, { authorization: `Bearer ${HOST_TOKEN}`, "x-stigmer-execution-id": EXECUTION });
  return (JSON.parse(answer.body) as { accessToken: string }).accessToken;
}

/** An HTTP/2 stream to the lane: writes each chunk once the previous echo came back, then ends. */
function stream(
  path: string,
  headers: Record<string, string>,
  chunks: readonly string[],
): Promise<{ readonly status: number; readonly data: string; readonly trailers: IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const session = connect(proxy.cursorEndpoint, { ca: proxy.cursorCertificate });
    session.on("error", reject);
    const req = session.request({ ":method": "POST", ":path": path, "content-type": "application/connect+proto", ...headers });
    let status = 0;
    let data = "";
    let trailers: IncomingHttpHeaders = {};
    let next = 0;
    const writeNext = (): void => {
      if (next < chunks.length) req.write(chunks[next++]);
      else req.end();
    };
    req.on("response", (h) => {
      status = Number(h[":status"]);
      if (status !== 200) req.end();
    });
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf8");
      writeNext();
    });
    req.on("trailers", (t) => (trailers = t));
    req.on("end", () => {
      session.close();
      resolve({ status, data, trailers });
    });
    req.on("error", reject);
    writeNext();
  });
}

beforeAll(async () => {
  await rest.start();
  await connectHost.start();
});
afterAll(async () => {
  await rest.stop();
  await connectHost.stop();
});
beforeEach(() => {
  rest.received.length = 0;
  rest.answer = FakeUpstream.DEFAULT_ANSWER;
  connectHost.streams.length = 0;
  connectHost.resetAfterHeaders = false;
  connectHost.closedCodes.length = 0;
  setEnv({ CURSOR_BACKEND_URL: rest.url });
});
afterEach(async () => {
  closeTurn();
  await proxy.close();
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
});

describe("terminate: a runner that calls Cursor itself", () => {
  beforeEach(() => startProxy());

  it("exchanges with the operator's key and hands the host a stand-in that names the token's expiry", async () => {
    const standIn = await exchange();

    expect(rest.last.path).toBe("/auth/exchange_user_api_key");
    expect(rest.last.headers.authorization).toBe(`Bearer ${OPERATOR_KEY}`);
    expect(Object.keys(rest.last.headers).filter((h) => h.startsWith("x-stigmer-"))).toEqual([]);
    expect(standIn).toMatch(/^stigmer\.[^.]+\.[^.]+$/);
    expect(standIn).not.toContain(REAL_TOKEN);
    expect(JSON.parse(Buffer.from(standIn.split(".")[1]!, "base64url").toString("utf8"))).toEqual({ exp: EXP });
  });

  it("drops the refresh token, and relays the rest of the exchange's answer", async () => {
    rest.answer = { status: 200, headers: { "content-type": "application/json", "x-cursor-region": "us" }, body: JSON.stringify({ accessToken: REAL_TOKEN, refreshToken: "r", plan: "pro" }) };
    const answer = await call(EXCHANGE, { authorization: `Bearer ${HOST_TOKEN}`, "x-stigmer-execution-id": EXECUTION });
    const parsed = JSON.parse(answer.body) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["accessToken", "plan"]);
    expect(parsed.plan).toBe("pro");
  });

  it("relays the agent run as a bidirectional stream with the real token, and its trailers", async () => {
    const standIn = await exchange();
    setEnv({ CURSOR_BACKEND_URL: connectHost.url });

    const answer = await stream(RUN, { authorization: `Bearer ${standIn}`, "x-stigmer-execution-id": EXECUTION, "x-stigmer-auth": `Bearer ${HOST_TOKEN}` }, ["one", "two"]);

    expect(answer.status).toBe(200);
    expect(answer.data).toBe("echo:oneecho:two");
    expect(answer.trailers["x-upstream-trailer"]).toBe("done");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connectHost.closedCodes, "a finished run closes cleanly at Cursor, never cancelled").toEqual([0]);
    const seen = connectHost.streams.at(-1)!;
    expect(seen.path).toBe(RUN);
    expect(seen.headers.authorization).toBe(`Bearer ${REAL_TOKEN}`);
    expect(Object.keys(seen.headers).filter((h) => h.startsWith("x-stigmer-"))).toEqual([]);
  });

  it("relays a side call over HTTP/1.1 with the real token, without an execution", async () => {
    const standIn = await exchange();
    rest.answer = { status: 200, headers: { "content-type": "application/json" }, body: "{}" };

    const answer = await call("/aiserver.v1.ServerConfigService/GetServerConfig", { authorization: `Bearer ${standIn}`, "content-type": "application/json" });

    expect(answer.status).toBe(200);
    expect(rest.last.path).toBe("/aiserver.v1.ServerConfigService/GetServerConfig");
    expect(rest.last.headers.authorization).toBe(`Bearer ${REAL_TOKEN}`);
  });

  it("relays other REST calls with the operator's key, to Cursor's own host when no backend is named", async () => {
    await call("/v1/proxy/cursor/api.cursor.com/v1/models", { authorization: `Bearer ${HOST_TOKEN}`, "x-stigmer-execution-id": EXECUTION });
    expect(rest.last.path).toBe("/v1/models");
    expect(rest.last.headers.authorization).toBe(`Bearer ${OPERATOR_KEY}`);
  });

  it("serves the key exchange at its one spelling only, so no variant carries the real token past custody", async () => {
    rest.answer = { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: REAL_TOKEN, refreshToken: "refresh-me" }) };
    for (const variant of [
      "/v1/proxy/cursor/api2.cursor.sh/auth/exchange_user_api_key/",
      "/v1/proxy/cursor/api2.cursor.sh//auth/exchange_user_api_key",
      "/v1/proxy/cursor/api2.cursor.sh/auth/exchange%5Fuser%5Fapi%5Fkey",
      "/v1/proxy/cursor/api2.cursor.sh/AUTH/exchange_user_api_key",
      "/v1/proxy/cursor/api2.cursor.sh/auth/other",
      "/v1/proxy/cursor/api2.cursor.sh/%E0%A4%A",
    ]) {
      const answer = await call(variant, { authorization: `Bearer ${HOST_TOKEN}`, "x-stigmer-execution-id": EXECUTION });
      expect(answer.status, variant).toBe(403);
      expect(answer.body).not.toContain(REAL_TOKEN);
    }
    expect(rest.received).toEqual([]);
  });

  it("checks the REST host as a parsed hostname", async () => {
    for (const host of ["user@api2.cursor.sh", "api2.cursor.sh:444", "evil.example%2F.api2.cursor.sh"]) {
      expect((await call(`/v1/proxy/cursor/${host}/v1/models`, { authorization: `Bearer ${HOST_TOKEN}`, "x-stigmer-execution-id": EXECUTION })).status, host).toBe(403);
    }
    expect(rest.received).toEqual([]);
  });

  it("refuses REST without the host's token, without a live execution, or to a host that is not Cursor's", async () => {
    expect((await call(EXCHANGE, { "x-stigmer-execution-id": EXECUTION })).status).toBe(401);
    expect((await call(EXCHANGE, { authorization: `Bearer ${HOST_TOKEN}` })).status).toBe(403);
    expect((await call(EXCHANGE, { authorization: `Bearer ${HOST_TOKEN}`, "x-stigmer-execution-id": "aex-gone" })).status).toBe(403);
    const elsewhere = await call("/v1/proxy/cursor/attacker.example/steal", { authorization: `Bearer ${HOST_TOKEN}`, "x-stigmer-execution-id": EXECUTION });
    expect(elsewhere.status).toBe(403);
    expect(JSON.parse(elsewhere.body)).toEqual({ code: "permission_denied", message: "the Cursor lane reaches Cursor's own hosts only, not attacker.example" });
    expect(rest.received).toEqual([]);
  });

  it("refuses a Connect call whose token it does not hold, and the agent run without a live execution", async () => {
    expect((await call(RUN, { "x-stigmer-execution-id": EXECUTION })).status, "no token at all").toBe(401);
    const unknown = await call(RUN, { authorization: `Bearer ${REAL_TOKEN}`, "x-stigmer-execution-id": EXECUTION });
    expect(unknown.status).toBe(401);
    expect(JSON.parse(unknown.body)).toEqual({ code: "unauthenticated", message: "the Cursor lane holds no such access token; exchange the API key again" });

    const standIn = await exchange();
    expect((await stream(RUN, { authorization: `Bearer ${standIn}` }, ["x"])).status).toBe(403);
    expect((await call("/somewhere/else", { authorization: `Bearer ${standIn}` })).status).toBe(404);
    expect(connectHost.streams).toEqual([]);
  });

  it("forgets every stand-in when a new host is authorized, and lets an expired token go", async () => {
    const standIn = await exchange();
    proxy.authorizeHost("the-next-host");
    expect((await call("/aiserver.v1.DashboardService/GetUserPrivacyMode", { authorization: `Bearer ${standIn}` })).status).toBe(401);

    proxy.authorizeHost(HOST_TOKEN);
    const expired = `h.${Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url")}.s`;
    rest.answer = { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: expired }) };
    const answer = await call(EXCHANGE, { authorization: `Bearer ${HOST_TOKEN}`, "x-stigmer-execution-id": EXECUTION });
    const expiredStandIn = (JSON.parse(answer.body) as { accessToken: string }).accessToken;
    expect((await call("/aiserver.v1.DashboardService/GetUserPrivacyMode", { authorization: `Bearer ${expiredStandIn}` })).status).toBe(401);
  });

  it("holds a token that names no expiry, and lets the oldest go once it holds too many", async () => {
    rest.answer = { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: "opaque-token" }) };
    const ask = async (): Promise<string> =>
      (JSON.parse((await call(EXCHANGE, { authorization: `Bearer ${HOST_TOKEN}`, "x-stigmer-execution-id": EXECUTION })).body) as { accessToken: string }).accessToken;
    const first = await ask();
    expect(JSON.parse(Buffer.from(first.split(".")[1]!, "base64url").toString("utf8"))).toEqual({});
    rest.answer = { status: 200, headers: {}, body: "{}" };
    expect((await call("/aiserver.v1.DashboardService/GetUserPrivacyMode", { authorization: `Bearer ${first}` })).status).toBe(200);

    rest.answer = { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: "opaque-token" }) };
    for (let i = 0; i < 1024; i++) await ask();
    expect((await call("/aiserver.v1.DashboardService/GetUserPrivacyMode", { authorization: `Bearer ${first}` })).status).toBe(401);
  });

  it("passes an exchange the upstream refused, or answered without a token, through unchanged", async () => {
    rest.answer = { status: 401, headers: { "content-type": "application/json" }, body: '{"error":"bad key"}' };
    expect(await call(EXCHANGE, { authorization: `Bearer ${HOST_TOKEN}`, "x-stigmer-execution-id": EXECUTION })).toEqual({ status: 401, body: '{"error":"bad key"}' });
    rest.answer = { status: 200, headers: {}, body: "not json" };
    expect(await call(EXCHANGE, { authorization: `Bearer ${HOST_TOKEN}`, "x-stigmer-execution-id": EXECUTION })).toEqual({ status: 200, body: "not json" });
  });

  it("cancels Cursor's stream when the host drops its own, and keeps serving after a drop mid-stream or mid-handshake", async () => {
    const standIn = await exchange();
    setEnv({ CURSOR_BACKEND_URL: connectHost.url });

    const session = connect(proxy.cursorEndpoint, { ca: proxy.cursorCertificate });
    const dropped = session.request({ ":method": "POST", ":path": RUN, authorization: `Bearer ${standIn}`, "x-stigmer-execution-id": EXECUTION });
    dropped.on("error", () => {});
    dropped.write("half");
    await new Promise((resolve) => dropped.once("data", resolve));
    session.destroy();

    const half = tlsConnect({ host: "127.0.0.1", port: Number(new URL(proxy.cursorEndpoint).port), rejectUnauthorized: false });
    half.on("error", () => {});
    half.destroy();

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(connectHost.closedCodes, "the abandoned run is cancelled at Cursor").toEqual([8]);
    expect((await stream(RUN, { authorization: `Bearer ${standIn}`, "x-stigmer-execution-id": EXECUTION }, ["after"])).data).toBe("echo:after");
  });

  it("resets the host's stream when Cursor's fails after its headers", async () => {
    const standIn = await exchange();
    setEnv({ CURSOR_BACKEND_URL: connectHost.url });
    connectHost.resetAfterHeaders = true;
    const reset = await new Promise<number>((resolve) => {
      const session = connect(proxy.cursorEndpoint, { ca: proxy.cursorCertificate });
      session.on("error", () => {});
      const req = session.request({ ":method": "POST", ":path": RUN, authorization: `Bearer ${standIn}`, "x-stigmer-execution-id": EXECUTION });
      req.on("error", () => {});
      req.on("close", () => {
        session.close();
        resolve(req.rstCode);
      });
      req.resume();
      req.end("x");
    });
    expect(reset, "an internal-error reset, never a clean end").toBe(2);
  });

  it("closes promptly while a host still holds connections open", async () => {
    const session = connect(proxy.cursorEndpoint, { ca: proxy.cursorCertificate });
    session.on("error", () => {});
    await new Promise<void>((resolve) => session.once("connect", () => resolve()));
    const closed = await Promise.race([proxy.close().then(() => "closed"), new Promise((resolve) => setTimeout(() => resolve("hung"), 2_000))]);
    expect(closed).toBe("closed");
    session.destroy();
    proxy = await AgentProxy.start(testConfig({ proxyEndpoint: null, cursorApiKey: OPERATOR_KEY }));
  });

  it("answers 502 when Cursor cannot be reached, on the stream and on the exchange", async () => {
    const standIn = await exchange();
    setEnv({ CURSOR_BACKEND_URL: "http://127.0.0.1:9" });
    const run = await stream(RUN, { authorization: `Bearer ${standIn}`, "x-stigmer-execution-id": EXECUTION }, ["x"]);
    expect(run.status).toBe(502);
    expect((await call(EXCHANGE, { authorization: `Bearer ${HOST_TOKEN}`, "x-stigmer-execution-id": EXECUTION })).status).toBe(502);
  });
});

describe("terminate without the operator's key", () => {
  beforeEach(() => startProxy({ cursorApiKey: "" }));

  it("names the setting the lane needs", async () => {
    const answer = await call(EXCHANGE, { authorization: `Bearer ${HOST_TOKEN}`, "x-stigmer-execution-id": EXECUTION });
    expect(answer.status).toBe(500);
    expect(JSON.parse(answer.body)).toEqual({ code: "internal", message: "the Cursor lane needs CURSOR_API_KEY on the runner" });
  });
});

describe("forward without a runner credential", () => {
  beforeEach(() => startProxy({ proxyEndpoint: rest.url, proxyTokenRef: { current: null }, stigmerTokenRef: { current: null } }));

  it("refuses to forward, and sends nothing", async () => {
    const answer = await call(EXCHANGE, { authorization: `Bearer ${HOST_TOKEN}`, "x-stigmer-execution-id": EXECUTION });
    expect(answer.status).toBe(503);
    expect(rest.received).toEqual([]);
  });
});

describe("forward: a runner behind the Stigmer platform's proxy", () => {
  beforeEach(() => startProxy({ proxyEndpoint: rest.url, proxyTokenRef: { current: RUNNER_TOKEN } }));

  it("exchanges through the platform's REST lane with the runner's credential and the execution id", async () => {
    await exchange();
    expect(rest.last.path).toBe(EXCHANGE);
    expect(rest.last.headers.authorization).toBe(`Bearer ${RUNNER_TOKEN}`);
    expect(Object.keys(rest.last.headers).filter((h) => h.startsWith("x-stigmer-"))).toEqual(["x-stigmer-execution-id"]);
  });

  it("opens the agent run on the platform's lane with the real token, the runner's credential and the execution id alone", async () => {
    // The REST and the Connect fakes are two servers; the platform's proxy is one. The lane reads its upstream per call,
    // so the test points the runner's platform endpoint at the REST fake for the exchange, then at the Connect fake.
    await proxy.close();
    closeTurn();
    const config: { -readonly [K in keyof Config]: Config[K] } = testConfig({ proxyEndpoint: rest.url, proxyTokenRef: { current: RUNNER_TOKEN } });
    proxy = await AgentProxy.start(config);
    proxy.authorizeHost(HOST_TOKEN);
    closeTurn = proxy.openTurn({ executionId: EXECUTION, threadId: "thread-ses-cursor" });
    const standIn = await exchange();
    config.proxyEndpoint = connectHost.url;

    const answer = await stream(RUN, { authorization: `Bearer ${standIn}`, "x-stigmer-execution-id": EXECUTION, "x-stigmer-mcp-server-id": "claimed" }, ["x"]);

    expect(answer.status).toBe(200);
    const seen = connectHost.streams.at(-1)!;
    expect(seen.headers.authorization).toBe(`Bearer ${REAL_TOKEN}`);
    expect(seen.headers["x-stigmer-auth"]).toBe(`Bearer ${RUNNER_TOKEN}`);
    expect(seen.headers["x-stigmer-execution-id"]).toBe(EXECUTION);
    expect(seen.headers["x-stigmer-mcp-server-id"]).toBeUndefined();
  });
});

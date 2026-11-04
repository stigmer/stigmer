/**
 * Pins the local-only gate (local-only.ts) and the bind choice
 * (boot/listen-host.ts) of a server without sign-in, where every tokenless
 * request is the operator:
 *
 *   - the rules: which origins are this machine's (loopback names, and the
 *     desktop app's webview), which Host names are loopback, and how a Host
 *     or :authority is read;
 *   - the gate over a real unified port bound to loopback: a request from
 *     another site is refused 403 before any lane sees it, the `text/plain`
 *     POST a browser sends without a preflight included; a request naming
 *     another host (DNS rebinding) is refused; the CLI's shape (no Origin)
 *     and the console on this machine pass; a server that signs its callers
 *     in keeps answering every origin, as before;
 *   - the bind: loopback by default without sign-in, every interface with
 *     it, an operator's choice kept, and a wider bind without sign-in
 *     warned about.
 */
import { request as httpRequest } from "node:http";
import type { IncomingMessage } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLogger } from "../../boot/logger.js";
import {
  ALL_INTERFACES_LISTEN_HOST,
  LOOPBACK_LISTEN_HOST,
  chooseListenHost,
} from "../../boot/listen-host.js";
import {
  FOREIGN_HOST_REFUSED,
  FOREIGN_ORIGIN_REFUSED,
  hostnameOf,
  isLocalOrigin,
  isLoopbackHostname,
  localOnlyRefusal,
} from "../local-only.js";
import type { LaneRequest } from "../lanes.js";
import { createUnifiedPortServer, type UnifiedPortServer } from "../server.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

describe("the rules", () => {
  it.each([
    ["http://localhost:3000", true],
    ["http://127.0.0.1:7234", true],
    ["https://localhost", true],
    ["http://[::1]:7234", true],
    ["http://app.localhost:5173", true],
    ["tauri://localhost", true],
    ["http://tauri.localhost", true],
    ["https://evil.example", false],
    ["http://localhost.evil.example", false],
    ["http://127.0.0.1.evil.example", false],
    ["http://192.168.1.5:7234", false],
    ["null", false],
    ["file://", false],
    ["not a url", false],
  ] as const)("origin %s is this machine's: %s", (origin, local) => {
    expect(isLocalOrigin(origin)).toBe(local);
  });

  it.each([
    ["localhost:7234", "localhost"],
    ["127.0.0.1:7234", "127.0.0.1"],
    ["[::1]:7234", "::1"],
    ["[::1]", "::1"],
    ["[broken", "[broken"],
    ["evil.example", "evil.example"],
  ] as const)("reads the hostname of %s as %s", (authority, hostname) => {
    expect(hostnameOf(authority)).toBe(hostname);
  });

  it.each([
    ["localhost", true],
    ["LOCALHOST", true],
    ["127.0.0.1", true],
    ["127.1.2.3", true],
    ["::1", true],
    ["::ffff:127.0.0.1", true],
    ["evil.example", false],
    ["10.0.0.1", false],
    ["127.0.0.1.evil.example", false],
  ] as const)("%s is a loopback name: %s", (hostname, loopback) => {
    expect(isLoopbackHostname(hostname)).toBe(loopback);
  });

  function laneRequest(headers: Record<string, string>, localAddress: string | undefined): LaneRequest {
    return { headers, socket: { localAddress } } as unknown as LaneRequest;
  }

  it("refuses a foreign Origin whatever interface the request came in on", () => {
    expect(localOnlyRefusal(laneRequest({ origin: "https://evil.example", host: "stigmer-server:7234" }, "172.18.0.3"))).toBe(
      FOREIGN_ORIGIN_REFUSED,
    );
  });

  it("checks the Host only for a request that arrived on loopback, reading HTTP/2's :authority first", () => {
    expect(localOnlyRefusal(laneRequest({ host: "stigmer-server:7234" }, "172.18.0.3"))).toBeUndefined();
    expect(localOnlyRefusal(laneRequest({ ":authority": "evil.example:7234" }, "127.0.0.1"))).toBe(FOREIGN_HOST_REFUSED);
    expect(localOnlyRefusal(laneRequest({ ":authority": "localhost:7234", host: "evil.example" }, "::1"))).toBeUndefined();
    expect(localOnlyRefusal(laneRequest({}, "127.0.0.1"))).toBeUndefined();
    expect(localOnlyRefusal(laneRequest({ host: "evil.example" }, undefined))).toBeUndefined();
  });
});

interface Answer {
  readonly status: number;
  readonly body: string;
  readonly allowOrigin: string | undefined;
}

/** One HTTP/1.1 request with exactly the headers given (fetch would set Host and Origin itself). */
function send(port: number, method: string, path: string, headers: Record<string, string>, body?: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method, path, headers, setHost: false }, (res: IncomingMessage) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (text += chunk));
      res.on("end", () => {
        const allow = res.headers["access-control-allow-origin"];
        resolve({ status: res.statusCode ?? 0, body: text, allowOrigin: typeof allow === "string" ? allow : undefined });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

function bootServer(localOnly: boolean): Promise<{ server: UnifiedPortServer; port: number }> {
  const server = createUnifiedPortServer({
    logger: silentLogger,
    routes: () => {},
    interceptors: [],
    modelRegistryLane: (_request, response) => {
      response.setHeader("x-lane", "model");
      response.end("{}");
    },
    ...(localOnly ? { localOnly } : {}),
  });
  return server.listen(0, "127.0.0.1").then((port) => ({ server, port }));
}

describe("a server without sign-in, over a real loopback port", () => {
  let server: UnifiedPortServer;
  let port = 0;
  beforeAll(async () => {
    ({ server, port } = await bootServer(true));
  });
  afterAll(async () => {
    await server.shutdown();
  });

  it("refuses another site's request 403 before any lane sees it, the preflight-free text/plain POST included", async () => {
    for (const [method, path, headers] of [
      ["GET", "/v1/proxy/model-registry", { host: `127.0.0.1:${port}`, origin: "https://evil.example" }],
      ["OPTIONS", "/ai.stigmer.Any/Method", { host: `127.0.0.1:${port}`, origin: "https://evil.example", "access-control-request-method": "POST" }],
      ["POST", "/v1/sessions/ses_1/events", { host: `127.0.0.1:${port}`, origin: "https://evil.example", "content-type": "text/plain" }],
    ] as const) {
      const answer = await send(port, method, path, headers, method === "POST" ? "{}" : undefined);
      expect(answer.status, `${method} ${path}`).toBe(403);
      expect(answer.body).toBe(FOREIGN_ORIGIN_REFUSED);
      expect(answer.allowOrigin).toBeUndefined();
    }
  });

  it("refuses a request naming another host (DNS rebinding)", async () => {
    const answer = await send(port, "GET", "/v1/proxy/model-registry", { host: `evil.example:${port}` });
    expect(answer.status).toBe(403);
    expect(answer.body).toBe(FOREIGN_HOST_REFUSED);
  });

  it("serves the CLI's shape (no Origin) and the console on this machine, CORS answered for it", async () => {
    const cli = await send(port, "GET", "/v1/proxy/model-registry", { host: `127.0.0.1:${port}` });
    expect(cli.status).toBe(200);
    const preflight = await send(port, "OPTIONS", "/ai.stigmer.Any/Method", {
      host: `localhost:${port}`,
      origin: "http://localhost:3000",
      "access-control-request-method": "POST",
    });
    expect(preflight.status).toBe(200);
    expect(preflight.allowOrigin).toBe("http://localhost:3000");
  });
});

describe("a server that signs its callers in", () => {
  it("answers every origin as before: its callers carry credentials", async () => {
    const { server, port } = await bootServer(false);
    try {
      const preflight = await send(port, "OPTIONS", "/ai.stigmer.Any/Method", {
        host: `api.example:${port}`,
        origin: "https://app.example",
        "access-control-request-method": "POST",
      });
      expect(preflight.status).toBe(200);
      expect(preflight.allowOrigin).toBe("https://app.example");
    } finally {
      await server.shutdown();
    }
  });
});

describe("the bind host", () => {
  it("is loopback without sign-in and every interface with it, when nobody chose", () => {
    expect(chooseListenHost({ chosen: undefined, requireAuthentication: false })).toEqual({ host: LOOPBACK_LISTEN_HOST });
    expect(chooseListenHost({ chosen: undefined, requireAuthentication: true })).toEqual({ host: ALL_INTERFACES_LISTEN_HOST });
  });

  it("keeps an operator's choice, and warns only about a wider bind without sign-in", () => {
    expect(chooseListenHost({ chosen: "0.0.0.0", requireAuthentication: true })).toEqual({ host: "0.0.0.0" });
    for (const loopback of ["127.0.0.1", "localhost", "::1"]) {
      expect(chooseListenHost({ chosen: loopback, requireAuthentication: false })).toEqual({ host: loopback });
    }
    const wide = chooseListenHost({ chosen: "0.0.0.0", requireAuthentication: false });
    expect(wide.host).toBe("0.0.0.0");
    expect(wide.warning).toMatch(/^listening on 0\.0\.0\.0 without sign-in: anyone who can reach this address acts as the operator/);
  });
});

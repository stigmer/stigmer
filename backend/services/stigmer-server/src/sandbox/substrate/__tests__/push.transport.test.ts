/**
 * Pins the router's transport (push.ts, newRouterFetch) over real sockets:
 * a local HTTPS server under a CA minted at test time, and a plain HTTP
 * one.
 *
 *   - a router whose certificate chains to the configured CA is reached,
 *     under the server-name override when one is given, and its
 *     connection is kept alive;
 *   - a wrong CA, a certificate without the URL's host, or a wrong
 *     override is a RouterTlsError naming the CA file and the name, which
 *     the push rethrows at once instead of retrying for its window;
 *   - a CA file replaced on disk is trusted on the next push, and the
 *     idle connection made under the old one is not reused;
 *   - http:// still works, the push's retries included;
 *   - boot refuses an unreadable CA file, one holding no certificate, and
 *     a CA or server name given for an http:// router;
 *   - an aborted push and a reply cut short reject.
 */
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import type { AddressInfo, Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TLSSocket } from "node:tls";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  mintCa,
  mintServerCertificate,
  type TestCa,
  type TestServerCertificate,
} from "../__test-utils__/test-ca.js";
import { newRouterFetch, pushAttach, RouterTlsError } from "../push.js";

const ROUTER_NAME = "atenet-router.ate-system.svc";

let routerCa: TestCa;
let otherCa: TestCa;
/** Names only the router's in-cluster name, as Substrate's servicedns certificate does. */
let routerCertificate: TestServerCertificate;
/** Names 127.0.0.1, so a URL by address checks without an override. */
let addressCertificate: TestServerCertificate;

beforeAll(async () => {
  routerCa = await mintCa("router test ca");
  otherCa = await mintCa("other test ca");
  routerCertificate = await mintServerCertificate(routerCa, {
    dns: [ROUTER_NAME],
  });
  addressCertificate = await mintServerCertificate(routerCa, {
    ip: ["127.0.0.1"],
  });
});

let dir: string;
const servers: (http.Server | https.Server)[] = [];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "substrate-router-tls-test-"));
});

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  rmSync(dir, { recursive: true, force: true });
});

interface Router {
  readonly url: string;
  readonly seen: {
    servername: string | false | null | undefined;
    path: string;
  }[];
  /** The TLS version each request arrived over. */
  readonly protocols: (string | null)[];
  /** Connections the server holds open now. */
  readonly open: Set<object>;
  connections: number;
}

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

const attached: Handler = (_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ started: true }));
};

async function listen(
  server: http.Server | https.Server,
  scheme: "http" | "https",
  handler: Handler,
): Promise<Router> {
  const router: Router = {
    url: "",
    seen: [],
    protocols: [],
    open: new Set(),
    connections: 0,
  };
  server.on(scheme === "https" ? "secureConnection" : "connection", () => {
    router.connections += 1;
  });
  server.on("connection", (socket: Socket) => {
    router.open.add(socket);
    socket.on("close", () => router.open.delete(socket));
  });
  server.on("request", (req: http.IncomingMessage, res) => {
    const socket = req.socket as Partial<TLSSocket>;
    router.seen.push({ servername: socket.servername, path: req.url ?? "" });
    if (socket.getProtocol) router.protocols.push(socket.getProtocol());
    handler(req, res);
  });
  servers.push(server);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  return Object.assign(router, { url: `${scheme}://127.0.0.1:${port}` });
}

function httpsRouter(
  certificate: TestServerCertificate,
  handler: Handler = attached,
): Promise<Router> {
  return listen(
    https.createServer({ cert: certificate.cert, key: certificate.key }),
    "https",
    handler,
  );
}

function httpRouter(handler: Handler = attached): Promise<Router> {
  return listen(http.createServer(), "http", handler);
}

function caFile(pem: string, name = "ca.pem"): string {
  const file = path.join(dir, name);
  writeFileSync(file, pem);
  return file;
}

/** Replaces the CA file's contents and moves its mtime, as a rotation does. */
function rotate(file: string, pem: string, step: number): void {
  writeFileSync(file, pem);
  const when = new Date(Date.now() + step * 10_000);
  utimesSync(file, when, when);
}

function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => void (t += ms),
    elapsed: () => t,
  };
}

function push(
  routerUrl: string,
  fetch: typeof globalThis.fetch,
  time = clock(),
) {
  return pushAttach(
    {
      routerUrl,
      atespace: "stigmer",
      actor: "sbx-ses-0123456789ab",
      taskQueue: "session:ses_1",
      secrets: { STIGMER_TOKEN: "tok" },
    },
    { fetch, now: time.now, sleep: time.sleep },
  );
}

describe("an https:// router", () => {
  it("is reached under the configured CA and the server-name override, and its connection is kept alive", async () => {
    const router = await httpsRouter(routerCertificate);
    const fetch = newRouterFetch({
      routerUrl: router.url,
      routerCaFile: caFile(routerCa.pem),
      routerServerName: ROUTER_NAME,
    });

    expect(await push(router.url, fetch)).toEqual({ ok: true, started: true });
    expect(await push(router.url, fetch)).toEqual({ ok: true, started: true });
    expect(router.seen).toEqual([
      { servername: ROUTER_NAME, path: "/attach" },
      { servername: ROUTER_NAME, path: "/attach" },
    ]);
    expect(router.connections).toBe(1);
    // Node's default floor and ceiling, as against Substrate's router.
    expect(router.protocols).toEqual(["TLSv1.3", "TLSv1.3"]);
  });

  it("checks the URL's host when no server name is given", async () => {
    const router = await httpsRouter(addressCertificate);
    const fetch = newRouterFetch({
      routerUrl: router.url,
      routerCaFile: caFile(routerCa.pem),
      routerServerName: "",
    });
    expect(await push(router.url, fetch)).toEqual({ ok: true, started: true });

    const named = await httpsRouter(routerCertificate);
    const unnamed = newRouterFetch({
      routerUrl: named.url,
      routerCaFile: caFile(routerCa.pem, "again.pem"),
      routerServerName: "",
    });
    const refusal = await push(named.url, unnamed).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(RouterTlsError);
    expect((refusal as RouterTlsError).code).toBe(
      "ERR_TLS_CERT_ALTNAME_INVALID",
    );
    expect((refusal as Error).message).toContain("for the name 127.0.0.1");
  });

  it("fails at once, as a RouterTlsError naming the CA file, when the certificate does not chain to the CA", async () => {
    const router = await httpsRouter(routerCertificate);
    const file = caFile(otherCa.pem);
    const time = clock();
    const refusal = await push(
      router.url,
      newRouterFetch({
        routerUrl: router.url,
        routerCaFile: file,
        routerServerName: ROUTER_NAME,
      }),
      time,
    ).catch((e: unknown) => e);

    expect(refusal).toBeInstanceOf(RouterTlsError);
    const message = (refusal as Error).message;
    expect(message).toContain(`the router at ${router.url}`);
    expect(message).toContain(`the CA in ${file}`);
    expect(message).toContain("STIGMER_SANDBOX_SUBSTRATE_ROUTER_CA_FILE");
    expect(message).toContain(`for the name ${ROUTER_NAME}`);
    expect(message).toContain("STIGMER_SANDBOX_SUBSTRATE_ROUTER_SERVER_NAME");
    expect(time.elapsed()).toBe(0);
    expect(router.seen).toEqual([]);
  });

  it("fails at once when the override names something the certificate does not", async () => {
    const router = await httpsRouter(routerCertificate);
    const time = clock();
    const refusal = await push(
      router.url,
      newRouterFetch({
        routerUrl: router.url,
        routerCaFile: caFile(routerCa.pem),
        routerServerName: "atenet-router.ate-system.svc.cluster.local",
      }),
      time,
    ).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(RouterTlsError);
    expect((refusal as RouterTlsError).code).toBe(
      "ERR_TLS_CERT_ALTNAME_INVALID",
    );
    expect(time.elapsed()).toBe(0);
  });

  it("names the system roots when no CA file is given", async () => {
    const router = await httpsRouter(routerCertificate);
    const refusal = await push(
      router.url,
      newRouterFetch({
        routerUrl: router.url,
        routerCaFile: "",
        routerServerName: ROUTER_NAME,
      }),
    ).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(RouterTlsError);
    expect((refusal as Error).message).toContain(
      "checked against the system roots",
    );
  });

  it("trusts a CA file replaced on disk from the next push, and drops the connection made under the old CA", async () => {
    const router = await httpsRouter(routerCertificate);
    const file = caFile(otherCa.pem);
    const fetch = newRouterFetch({
      routerUrl: router.url,
      routerCaFile: file,
      routerServerName: ROUTER_NAME,
    });

    await expect(push(router.url, fetch)).rejects.toBeInstanceOf(
      RouterTlsError,
    );
    rotate(file, routerCa.pem, 1);
    expect(await push(router.url, fetch)).toEqual({ ok: true, started: true });
    expect(router.open.size).toBe(1);
    rotate(file, otherCa.pem, 2);
    await expect(push(router.url, fetch)).rejects.toBeInstanceOf(
      RouterTlsError,
    );
    // The kept-alive connection trusted under the old CA is closed, well
    // before the server's own 5 s keep-alive timeout would close it.
    await expect.poll(() => router.open.size, { timeout: 2_000 }).toBe(0);
  });
});

describe("an http:// router", () => {
  it("is reached, keeps its connection, and is retried while not ready", async () => {
    const answers = [503, 200];
    const router = await httpRouter((_req, res) => {
      const status = answers.shift() ?? 200;
      res.writeHead(status, { "x-router": "yes" });
      res.end(status === 200 ? JSON.stringify({ started: false }) : "warming");
    });
    const fetch = newRouterFetch({
      routerUrl: router.url,
      routerCaFile: "",
      routerServerName: "",
    });
    const time = clock();
    expect(await push(router.url, fetch, time)).toEqual({
      ok: true,
      started: false,
    });
    expect(router.seen.map((s) => s.path)).toEqual(["/attach", "/attach"]);
    expect(router.connections).toBe(1);
    expect(time.elapsed()).toBeGreaterThan(0);

    const reply = await fetch(`${router.url}/attach`, { method: "POST" });
    expect(reply.headers.get("x-router")).toBe("yes");
  });

  it("retries a refused connection for the push's window, then names the router as unreachable", async () => {
    const router = await httpRouter();
    const closed = servers.pop();
    closed?.closeAllConnections();
    await new Promise<void>((resolve) => closed?.close(() => resolve()));
    const time = clock();
    const failure = await push(
      router.url,
      newRouterFetch({
        routerUrl: router.url,
        routerCaFile: "",
        routerServerName: "",
      }),
      time,
    ).catch((e: unknown) => e);
    expect(failure).not.toBeInstanceOf(RouterTlsError);
    expect((failure as Error).message).toMatch(
      /could not reach the router: connect ECONNREFUSED/,
    );
    expect(time.elapsed()).toBeGreaterThanOrEqual(15_000);
  });

  it("gives a reply with no body as one", async () => {
    const router = await httpRouter((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    const fetch = newRouterFetch({
      routerUrl: router.url,
      routerCaFile: "",
      routerServerName: "",
    });
    const reply = await fetch(`${router.url}/attach`);
    expect(reply.status).toBe(204);
    expect(reply.body).toBeNull();
  });
});

describe("a push that does not finish", () => {
  it("rejects when aborted, before it starts or while it waits", async () => {
    const router = await httpRouter(() => {
      // Never answers.
    });
    const fetch = newRouterFetch({
      routerUrl: router.url,
      routerCaFile: "",
      routerServerName: "",
    });
    await expect(
      fetch(`${router.url}/attach`, { signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    await expect(
      fetch(`${router.url}/attach`, { signal: AbortSignal.timeout(50) }),
    ).rejects.toThrow();

    const reasonless = new AbortController();
    const pending = fetch(`${router.url}/attach`, {
      signal: reasonless.signal,
    });
    reasonless.abort("stop");
    await expect(pending).rejects.toThrow(/the push was aborted/);
  });

  it("rejects when the reply is cut short", async () => {
    const router = await httpRouter((_req, res) => {
      res.writeHead(200, { "content-length": "100" });
      res.write("{");
      setImmediate(() => res.socket?.destroy());
    });
    const fetch = newRouterFetch({
      routerUrl: router.url,
      routerCaFile: "",
      routerServerName: "",
    });
    await expect(fetch(`${router.url}/attach`)).rejects.toThrow();
  });
});

describe("boot", () => {
  it("refuses an unreadable CA file, and one holding no certificate, naming the variable", () => {
    const routerUrl = "https://atenet-router.ate-system.svc";
    expect(() =>
      newRouterFetch({
        routerUrl,
        routerCaFile: path.join(dir, "missing.pem"),
        routerServerName: "",
      }),
    ).toThrow(
      /STIGMER_SANDBOX_SUBSTRATE_ROUTER_CA_FILE \(.*missing\.pem\) cannot be used as the router's CA/,
    );
    expect(() =>
      newRouterFetch({
        routerUrl,
        routerCaFile: caFile("not a certificate", "junk.pem"),
        routerServerName: "",
      }),
    ).toThrow(/holds no PEM certificate/);
  });

  it("refuses a CA or a server name for an http:// router, where it would do nothing", () => {
    expect(() =>
      newRouterFetch({
        routerUrl: "http://router.example",
        routerCaFile: caFile(routerCa.pem),
        routerServerName: "",
      }),
    ).toThrow(
      /STIGMER_SANDBOX_SUBSTRATE_ROUTER_CA_FILE applies only to an https:\/\/ router/,
    );
    expect(() =>
      newRouterFetch({
        routerUrl: "http://router.example",
        routerCaFile: "",
        routerServerName: ROUTER_NAME,
      }),
    ).toThrow(
      /STIGMER_SANDBOX_SUBSTRATE_ROUTER_SERVER_NAME applies only to an https:\/\/ router/,
    );
  });
});

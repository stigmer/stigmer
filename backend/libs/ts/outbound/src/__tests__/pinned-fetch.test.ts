/**
 * Pins the pinned dialer against a real HTTP server on loopback that counts
 * the connections it accepts: a name that answers public to the check and
 * private to the socket is refused with no connection made; the socket goes
 * to the address the injected lookup gave and nowhere the system resolver
 * would; every address is judged at connect, a literal host too, and a
 * redirect undici follows itself as well; the lookup honours `all` and
 * filters by `family` without widening; a connect-time refusal is the
 * check's own `EgressError`, while any other failure stays the platform's
 * `TypeError`. Then the adapter: method, headers and each body kind arrive
 * as sent, any other body is refused before a connection, a null-body
 * status answers a null body, and a manual redirect comes back untouched.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { LookupAddress } from "node:dns";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { egressPolicyForPosture, type EgressPolicy } from "../egress/address.js";
import { EgressError, type EgressRefusal, type LookupFn } from "../egress/check.js";
import type { OutboundFetch } from "../egress/fetch.js";
import { judgingLookup, nodeGuardedFetch, pinnedFetch } from "../dial/pinned-fetch.js";

const strict = egressPolicyForPosture("strict");
const relaxed = egressPolicyForPosture("relaxed");

/** A documentation address no policy refuses: the "public" answer a rebinding name gives first. */
const PUBLIC = "203.0.113.10";

function table(entries: Record<string, readonly string[]>): LookupFn {
  return async (hostname) => {
    const found = entries[hostname];
    if (found === undefined) throw new Error(`ENOTFOUND ${hostname}`);
    return found;
  };
}

/** A lookup that answers each call with the next of `answers`: the rebinding name. */
function rebinding(...answers: (readonly string[])[]): { lookup: LookupFn; calls: string[] } {
  const calls: string[] = [];
  const lookup: LookupFn = async (hostname) => {
    calls.push(hostname);
    const answer = answers[calls.length - 1];
    if (answer === undefined) throw new Error(`no answer scripted for call ${calls.length}`);
    return answer;
  };
  return { lookup, calls };
}

async function refusalOf(pending: Promise<unknown>): Promise<EgressRefusal> {
  const error = await pending.then(
    () => undefined,
    (rejected: unknown) => rejected,
  );
  if (!(error instanceof EgressError)) throw new Error(`expected an EgressError, got ${String(error)}`);
  return error.refusal;
}

let server: Server;
let port: number;
let connections: number;

function answer(request: IncomingMessage, response: ServerResponse, body: Buffer): void {
  switch (request.url) {
    case "/echo":
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          method: request.method,
          contentType: request.headers["content-type"] ?? null,
          marker: request.headers["x-marker"] ?? null,
          body: body.toString("latin1"),
        }),
      );
      return;
    case "/no-content":
      response.statusCode = 204;
      response.end();
      return;
    case "/redirect":
      response.statusCode = 302;
      response.setHeader("location", "/");
      response.end();
      return;
    case "/redirect-to-literal":
      response.statusCode = 302;
      response.setHeader("location", `http://[::1]:${port}/`);
      response.end();
      return;
    default:
      response.end("hello world");
  }
}

beforeEach(async () => {
  connections = 0;
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => answer(request, response, Buffer.concat(chunks)));
  });
  server.on("connection", () => {
    connections += 1;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("nodeGuardedFetch", () => {
  it("refuses a name that answers public to the check and private to the socket, with no connection made", async () => {
    const { lookup, calls } = rebinding([PUBLIC], ["127.0.0.1"]);
    const fetchGuarded = nodeGuardedFetch(strict, { lookup });

    const pending = fetchGuarded(`http://rebind.test:${port}/`);

    await expect(pending).rejects.toThrow("Refusing to reach rebind.test: it does not resolve to a public address.");
    expect(await refusalOf(pending)).toMatchObject({ kind: "blocked", hostname: "rebind.test", address: "127.0.0.1", reason: "loopback" });
    expect(calls).toEqual(["rebind.test", "rebind.test"]);
    expect(connections).toBe(0);
  });

  it("answers a name that stops resolving between the check and the socket as unresolvable", async () => {
    const { lookup } = rebinding([PUBLIC]);
    const refusal = await refusalOf(nodeGuardedFetch(strict, { lookup })(`http://gone.test:${port}/`));
    expect(refusal).toMatchObject({ kind: "unresolvable", hostname: "gone.test", policy: "strict" });
    expect(connections).toBe(0);
  });

  it("dials through the process resolver and the pinned dialer by default", async () => {
    const response = await nodeGuardedFetch(relaxed)(`http://127.0.0.1:${port}/`);
    expect(await response.text()).toBe("hello world");
    expect(connections).toBe(1);
  });

  it("guards an injected fetch with the same policy and passes the body bound through", async () => {
    const dialled: string[] = [];
    const fetchImpl: OutboundFetch = async (url) => {
      dialled.push(String(url));
      return new Response("hello world");
    };
    const fetchGuarded = nodeGuardedFetch(strict, { fetchImpl, lookup: table({ "a.vendor.test": [PUBLIC] }), maxResponseBytes: 4 });

    const response = await fetchGuarded("https://a.vendor.test/doc");
    expect(await refusalOf(response.text())).toMatchObject({ kind: "response-too-large", maxBytes: 4 });
    await expect(fetchGuarded("https://internal.vendor.test/doc")).rejects.toBeInstanceOf(EgressError);
    expect(dialled).toEqual(["https://a.vendor.test/doc"]);
  });
});

describe("pinnedFetch", () => {
  it("dials the address the injected lookup gave, which the system resolver could not have", async () => {
    const response = await pinnedFetch(relaxed, { lookup: table({ "pinned.test": ["127.0.0.1"] }) })(`http://pinned.test:${port}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello world");
    expect(connections).toBe(1);
  });

  it("judges every address at connect: one refused address refuses the dial", async () => {
    const dial = pinnedFetch(strict, { lookup: table({ "mixed.test": [PUBLIC, "127.0.0.1"] }) });
    expect(await refusalOf(dial(`http://mixed.test:${port}/`))).toMatchObject({ kind: "blocked", hostname: "mixed.test", address: "127.0.0.1" });
    expect(connections).toBe(0);
  });

  it("judges a literal host at connect, naming its range", async () => {
    const pending = pinnedFetch(strict, { lookup: table({}) })(`http://127.0.0.1:${port}/`);
    await expect(pending).rejects.toThrow("it resolves to 127.0.0.1, a loopback address the strict egress policy does not dial");
    expect(connections).toBe(0);

    const allowed = await pinnedFetch(relaxed, { lookup: table({}) })(`http://127.0.0.1:${port}/`);
    expect(await allowed.text()).toBe("hello world");
  });

  it("judges a redirect undici follows itself", async () => {
    const onlyLoopbackV4: EgressPolicy = { name: "relaxed", blockedReason: (address) => (address === "127.0.0.1" ? null : "test-refused") };
    const dial = pinnedFetch(onlyLoopbackV4, { lookup: table({}) });

    const refusal = await refusalOf(dial(`http://127.0.0.1:${port}/redirect-to-literal`, { redirect: "follow" }));
    expect(refusal).toMatchObject({ kind: "blocked", hostname: "::1", address: "::1", reason: "test-refused" });
    expect(connections).toBe(1);
  });

  it("answers a name that resolves to nothing as unresolvable", async () => {
    const empty = await refusalOf(pinnedFetch(strict, { lookup: table({ "empty.test": [] }) })(`http://empty.test:${port}/`));
    expect(empty).toMatchObject({ kind: "unresolvable", hostname: "empty.test" });
    const failing = await refusalOf(pinnedFetch(relaxed, { lookup: table({}) })(`http://failing.test:${port}/`));
    expect(failing).toMatchObject({ kind: "unresolvable", hostname: "failing.test", policy: "relaxed" });
    expect(connections).toBe(0);
  });

  it("leaves a failure that is not a refusal as the platform's TypeError", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const error = await pinnedFetch(relaxed, { lookup: table({ "closed.test": ["127.0.0.1"] }) })(`http://closed.test:${closedPort}/`).then(
      () => undefined,
      (rejected: unknown) => rejected,
    );
    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(EgressError);
  });

  describe("the adapter", () => {
    const dial = (): OutboundFetch => pinnedFetch(relaxed, { lookup: table({ "echo.test": ["127.0.0.1"] }) });

    it("carries the method, the headers and a string body", async () => {
      const response = await dial()(`http://echo.test:${port}/echo`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-marker": "m1" },
        body: JSON.stringify({ a: 1 }),
      });
      expect(await response.json()).toEqual({ method: "POST", contentType: "application/json", marker: "m1", body: '{"a":1}' });
      expect(response.headers.get("content-type")).toBe("application/json");
    });

    it("carries form parameters with their content type", async () => {
      const response = await dial()(`http://echo.test:${port}/echo`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: "c 1" }) });
      expect(await response.json()).toMatchObject({ contentType: "application/x-www-form-urlencoded;charset=UTF-8", body: "grant_type=authorization_code&code=c+1" });
    });

    it("carries bytes as bytes", async () => {
      const fromView = await dial()(`http://echo.test:${port}/echo`, { method: "PUT", body: new Uint8Array([0, 255, 65]) });
      expect(await fromView.json()).toMatchObject({ method: "PUT", body: "\u0000ÿA" });
      const fromBuffer = await dial()(`http://echo.test:${port}/echo`, { method: "PUT", body: new Uint8Array([66, 67]).buffer });
      expect(await fromBuffer.json()).toMatchObject({ body: "BC" });
    });

    it("refuses any other body before a connection opens", async () => {
      await expect(dial()(`http://echo.test:${port}/echo`, { method: "POST", body: new Blob(["x"]) })).rejects.toThrow(
        "The pinned dialer carries a string, URLSearchParams or bytes body, not Blob",
      );
      expect(connections).toBe(0);
    });

    it("answers a null-body status with a null body", async () => {
      const response = await dial()(`http://echo.test:${port}/no-content`);
      expect(response.status).toBe(204);
      expect(response.body).toBeNull();
    });

    it("returns a manual redirect untouched", async () => {
      const response = await dial()(`http://echo.test:${port}/redirect`, { redirect: "manual" });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/");
      expect(connections).toBe(1);
    });
  });
});

describe("judgingLookup", () => {
  const lookupOf = (addresses: readonly string[]) => judgingLookup(relaxed, table({ "host.test": addresses }));

  function ask(
    lookup: ReturnType<typeof judgingLookup>,
    options: { all?: boolean; family?: number | "IPv4" | "IPv6" },
  ): Promise<{ error: Error | null; address: string | LookupAddress[]; family: number | undefined }> {
    return new Promise((resolve) => {
      lookup("host.test", options, (error, address, family) => resolve({ error, address, family }));
    });
  }

  it("answers a list when asked for all, and the first address otherwise", async () => {
    const lookup = lookupOf([PUBLIC, "2001:db8::1"]);
    expect(await ask(lookup, { all: true })).toMatchObject({
      error: null,
      address: [
        { address: PUBLIC, family: 4 },
        { address: "2001:db8::1", family: 6 },
      ],
    });
    expect(await ask(lookup, {})).toEqual({ error: null, address: PUBLIC, family: 4 });
  });

  it("filters the judged list by family and never widens it", async () => {
    const lookup = lookupOf([PUBLIC, "2001:db8::1"]);
    expect(await ask(lookup, { family: 6 })).toEqual({ error: null, address: "2001:db8::1", family: 6 });
    expect(await ask(lookup, { family: "IPv6", all: true })).toMatchObject({ address: [{ address: "2001:db8::1", family: 6 }] });
    expect(await ask(lookup, { family: "IPv4" })).toEqual({ error: null, address: PUBLIC, family: 4 });

    const v4Only = await ask(lookupOf([PUBLIC]), { family: 6 });
    expect(v4Only.error?.name).toBe("ConnectRefusal");
  });

  it("judges every address before filtering, so a refused address of the other family still refuses", async () => {
    const lookup = judgingLookup(strict, table({ "host.test": [PUBLIC, "::1"] }));
    const answer = await ask(lookup, { family: 4 });
    expect(answer.error?.message).toBe("host.test resolves to a refused address");
  });
});

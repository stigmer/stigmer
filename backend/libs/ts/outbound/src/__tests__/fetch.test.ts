/**
 * Pins the guarded fetch: the first URL and every hop judged, a caller's
 * `redirect: "manual"` honoured, `redirect: "error"` thrown like fetch, the
 * hop budget, the Authorization header dropped across origins, and the
 * method rewrite a 303 (or a 301/302 on a POST) implies. Then the body
 * bound: a body within it reads whole, one that runs past it or declares
 * a length past it rejects its read (never the dial) as
 * `response-too-large`, the default is a mebibyte, and an unbounded caller
 * reads everything.
 */
import { describe, expect, it } from "vitest";

import { egressPolicyForPosture } from "../egress/address.js";
import { EgressError, type LookupFn } from "../egress/check.js";
import { asFetch, DEFAULT_MAX_RESPONSE_BYTES, guardedFetch, type OutboundFetch } from "../egress/fetch.js";

const strict = egressPolicyForPosture("strict");

const lookup: LookupFn = async (hostname) => {
  const table: Record<string, readonly string[]> = {
    "a.vendor.test": ["104.16.0.1"],
    "b.vendor.test": ["104.16.0.2"],
    "internal.vendor.test": ["10.0.0.5"],
  };
  const found = table[hostname];
  if (found === undefined) throw new Error(`ENOTFOUND ${hostname}`);
  return found;
};

interface Seen {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: RequestInit["body"];
  readonly redirect: RequestInit["redirect"];
}

function scripted(answers: Record<string, () => Response>): { fetchImpl: OutboundFetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl: OutboundFetch = async (url, init) => {
    const key = String(url);
    seen.push({ url: key, method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body, redirect: init?.redirect });
    const answer = answers[key];
    if (answer === undefined) throw new Error(`unscripted ${key}`);
    return answer();
  };
  return { fetchImpl, seen };
}

const redirect = (status: number, location: string): Response => new Response(null, { status, headers: { location } });
const ok = (): Response => new Response("ok", { status: 200 });

describe("guardedFetch", () => {
  it("judges the URL before dialling and refuses a blocked one without calling fetch", async () => {
    const { fetchImpl, seen } = scripted({});
    const fetchGuarded = guardedFetch(strict, { fetchImpl, lookup });
    await expect(fetchGuarded("https://internal.vendor.test/mcp")).rejects.toBeInstanceOf(EgressError);
    expect(seen).toHaveLength(0);
  });

  it("dials an allowed URL with the caller's init and asks the underlying fetch for manual redirects", async () => {
    const { fetchImpl, seen } = scripted({ "https://a.vendor.test/mcp": ok });
    const fetchGuarded = guardedFetch(strict, { fetchImpl, lookup });
    const response = await fetchGuarded("https://a.vendor.test/mcp", { method: "POST", body: "{}", headers: { Accept: "application/json" } });
    expect(response.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "POST", body: "{}", redirect: "manual" });
    expect(seen[0]?.headers.get("accept")).toBe("application/json");
  });

  it("follows a redirect and judges the hop, refusing one that lands on a blocked address", async () => {
    const { fetchImpl, seen } = scripted({
      "https://a.vendor.test/mcp": () => redirect(302, "https://internal.vendor.test/mcp"),
    });
    const fetchGuarded = guardedFetch(strict, { fetchImpl, lookup });
    await expect(fetchGuarded("https://a.vendor.test/mcp")).rejects.toMatchObject({ refusal: { kind: "blocked", hostname: "internal.vendor.test" } });
    expect(seen.map((s) => s.url)).toEqual(["https://a.vendor.test/mcp"]);
  });

  it("follows an allowed hop and resolves a relative Location against the current URL", async () => {
    const { fetchImpl, seen } = scripted({
      "https://a.vendor.test/mcp": () => redirect(301, "/mcp/"),
      "https://a.vendor.test/mcp/": ok,
    });
    const fetchGuarded = guardedFetch(strict, { fetchImpl, lookup });
    const response = await fetchGuarded("https://a.vendor.test/mcp");
    expect(response.status).toBe(200);
    expect(seen.map((s) => s.url)).toEqual(["https://a.vendor.test/mcp", "https://a.vendor.test/mcp/"]);
  });

  it("returns the 3xx untouched when the caller asked for manual redirects", async () => {
    const { fetchImpl, seen } = scripted({ "https://a.vendor.test/authorize": () => redirect(302, "https://b.vendor.test/login") });
    const fetchGuarded = guardedFetch(strict, { fetchImpl, lookup });
    const response = await fetchGuarded("https://a.vendor.test/authorize", { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(seen).toHaveLength(1);
  });

  it("throws a TypeError on a redirect when the caller asked for redirect: error", async () => {
    const { fetchImpl } = scripted({ "https://a.vendor.test/x": () => redirect(302, "https://b.vendor.test/y") });
    const fetchGuarded = guardedFetch(strict, { fetchImpl, lookup });
    await expect(fetchGuarded("https://a.vendor.test/x", { redirect: "error" })).rejects.toBeInstanceOf(TypeError);
  });

  it("refuses past the hop budget", async () => {
    const { fetchImpl, seen } = scripted({
      "https://a.vendor.test/1": () => redirect(302, "https://a.vendor.test/2"),
      "https://a.vendor.test/2": () => redirect(302, "https://a.vendor.test/3"),
      "https://a.vendor.test/3": () => redirect(302, "https://a.vendor.test/4"),
      "https://a.vendor.test/4": () => redirect(302, "https://a.vendor.test/5"),
    });
    const fetchGuarded = guardedFetch(strict, { fetchImpl, lookup });
    await expect(fetchGuarded("https://a.vendor.test/1")).rejects.toMatchObject({ refusal: { kind: "too-many-redirects", hops: 3 } });
    expect(seen).toHaveLength(4);
  });

  it("drops the Authorization header on a cross-origin hop and keeps it on a same-origin one", async () => {
    const { fetchImpl, seen } = scripted({
      "https://a.vendor.test/x": () => redirect(307, "https://a.vendor.test/y"),
      "https://a.vendor.test/y": () => redirect(307, "https://b.vendor.test/z"),
      "https://b.vendor.test/z": ok,
    });
    const fetchGuarded = guardedFetch(strict, { fetchImpl, lookup });
    await fetchGuarded("https://a.vendor.test/x", { method: "POST", body: "{}", headers: { Authorization: "Bearer t" } });
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer t");
    expect(seen[1]?.headers.get("authorization")).toBe("Bearer t");
    expect(seen[2]?.headers.get("authorization")).toBeNull();
    // 307 keeps the method and the body.
    expect(seen[2]).toMatchObject({ method: "POST", body: "{}" });
  });

  it("turns a 303, or a 301/302 answering a POST, into a GET without a body", async () => {
    const { fetchImpl, seen } = scripted({
      "https://a.vendor.test/post": () => redirect(303, "https://a.vendor.test/result"),
      "https://a.vendor.test/result": ok,
      "https://a.vendor.test/post2": () => redirect(302, "https://a.vendor.test/result2"),
      "https://a.vendor.test/result2": ok,
    });
    const fetchGuarded = guardedFetch(strict, { fetchImpl, lookup });
    await fetchGuarded("https://a.vendor.test/post", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    expect(seen[1]).toMatchObject({ method: "GET", body: undefined });
    expect(seen[1]?.headers.get("content-type")).toBeNull();
    await fetchGuarded("https://a.vendor.test/post2", { method: "POST", body: "{}" });
    expect(seen[3]).toMatchObject({ method: "GET", body: undefined });
  });

  it("asFetch wears the global fetch's shape and refuses a Request input rather than flattening it", async () => {
    const { fetchImpl, seen } = scripted({ "https://a.vendor.test/mcp": ok });
    const wrapped = asFetch(guardedFetch(strict, { fetchImpl, lookup }));
    await expect(wrapped("https://a.vendor.test/mcp")).resolves.toHaveProperty("status", 200);
    await expect(wrapped(new URL("https://a.vendor.test/mcp"))).resolves.toHaveProperty("status", 200);
    await expect(wrapped(new Request("https://a.vendor.test/mcp"))).rejects.toBeInstanceOf(TypeError);
    expect(seen).toHaveLength(2);
  });

  it("passes the caller's signal through to the check and to every hop", async () => {
    const controller = new AbortController();
    const { fetchImpl } = scripted({});
    const hanging: LookupFn = () => new Promise(() => undefined);
    const fetchGuarded = guardedFetch(strict, { fetchImpl, lookup: hanging });
    const pending = fetchGuarded("https://a.vendor.test/mcp", { signal: controller.signal });
    controller.abort(new Error("deadline"));
    await expect(pending).rejects.toThrow("deadline");
  });
});

/** A body served in chunks with no declared length, as a streaming server sends it. */
function chunked(...chunks: readonly string[]): () => Response {
  return () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  };
}

async function refusalOf(pending: Promise<unknown>): Promise<unknown> {
  try {
    await pending;
  } catch (error) {
    return error instanceof EgressError ? error.refusal : error;
  }
  throw new Error("the read resolved");
}

describe("guardedFetch's body bound", () => {
  it("reads a body within the bound whole, with the status and headers it came with", async () => {
    const { fetchImpl } = scripted({
      "https://a.vendor.test/jwks": () => new Response('{"keys":[]}', { status: 200, headers: { "content-type": "application/json" } }),
    });
    const response = await guardedFetch(strict, { fetchImpl, lookup, maxResponseBytes: 64 })("https://a.vendor.test/jwks");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual({ keys: [] });
  });

  it("resolves the dial and rejects the read of a body that runs past the bound", async () => {
    const { fetchImpl } = scripted({ "https://a.vendor.test/jwks": chunked("0123456789", "0123456789") });
    const response = await guardedFetch(strict, { fetchImpl, lookup, maxResponseBytes: 15 })("https://a.vendor.test/jwks");
    expect(response.status).toBe(200);
    expect(await refusalOf(response.text())).toMatchObject({ kind: "response-too-large", maxBytes: 15 });
  });

  it("rejects the first read of a body whose declared length is past the bound", async () => {
    const { fetchImpl } = scripted({
      "https://a.vendor.test/jwks": () => new Response("0123456789", { status: 200, headers: { "content-length": "10" } }),
    });
    const response = await guardedFetch(strict, { fetchImpl, lookup, maxResponseBytes: 9 })("https://a.vendor.test/jwks");
    const refusal = await refusalOf(response.arrayBuffer());
    expect(refusal).toMatchObject({ kind: "response-too-large", maxBytes: 9 });
    expect((refusal as { url: URL }).url.href).toBe("https://a.vendor.test/jwks");
  });

  it("bounds every caller by a mebibyte unless it says otherwise", async () => {
    expect(DEFAULT_MAX_RESPONSE_BYTES).toBe(1024 * 1024);
    const oversized = "x".repeat(DEFAULT_MAX_RESPONSE_BYTES + 1);
    const { fetchImpl } = scripted({ "https://a.vendor.test/doc": chunked(oversized) });
    const response = await guardedFetch(strict, { fetchImpl, lookup })("https://a.vendor.test/doc");
    expect(await refusalOf(response.text())).toMatchObject({ kind: "response-too-large", maxBytes: DEFAULT_MAX_RESPONSE_BYTES });
  });

  it("reads everything for a caller that streams", async () => {
    const { fetchImpl } = scripted({ "https://a.vendor.test/events": chunked("a".repeat(32), "b".repeat(32)) });
    const response = await guardedFetch(strict, { fetchImpl, lookup, maxResponseBytes: Number.POSITIVE_INFINITY })("https://a.vendor.test/events");
    await expect(response.text()).resolves.toHaveLength(64);
  });

  it("describes the refusal with the bound and the URL", () => {
    const error = new EgressError({ kind: "response-too-large", url: new URL("https://a.vendor.test/jwks"), maxBytes: 9 });
    expect(error.message).toBe("Refusing to read more than 9 bytes from https://a.vendor.test/jwks.");
  });
});

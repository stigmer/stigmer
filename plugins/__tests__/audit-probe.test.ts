/**
 * The endpoint probe over a fake `fetch`: every outcome, every rung of the
 * metadata ladder, the SSE arm and the retry, with no network.
 *
 * Pins, in order of what would hurt most if it regressed: the 401 rule is
 * the shared one (`@stigmer/outbound/mcp-oauth`, the runner's and the
 * control plane's), proven on the same header strings its own tests use, so
 * what this audit calls OAuth is what a user is told is OAuth; the request is a complete `initialize`, and a 2xx is read as
 * JSON-RPC, so a server that answers 200 with "Missing protocol version"
 * (Google's do, to a bare request) is a rejected handshake and never
 * `open`; a challenge with a `resource_metadata` pointer resolves through
 * it to a login server on another origin (the case today's discovery cannot
 * reach); a challenge without one falls back to the well-known documents at
 * the MCP origin; a login server without a `registration_endpoint` is
 * reported as such, not as a failure; a 4xx other than 401 is followed by
 * the event-stream GET, whose body is never read; a 5xx and a network
 * failure are retried once and the retry is marked in the evidence; a 429's
 * `Retry-After` is honoured and capped; and every request made is in the
 * evidence with its raw header.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  INITIALIZE_REQUEST,
  MCP_PROTOCOL_VERSION,
  isOAuthChallenge,
  parseResourceMetadataUrl,
  probeEndpoint,
  type ProbeDeps,
  RETRY_AFTER_CAP_MS,
  RETRY_PAUSE_MS,
} from "../scripts/audit/probe.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/audit/", import.meta.url));
const fixture = (name: string): string => readFileSync(`${FIXTURES}${name}`, "utf8");

const MCP_URL = "https://mcp.vendor.example/mcp";
const OAUTH_CHALLENGE = 'Bearer realm="OAuth", resource_metadata="https://mcp.vendor.example/.well-known/oauth-protected-resource/mcp"';

/** One scripted answer: a Response to hand back, or an Error to throw. */
type Scripted = Response | Error;

/**
 * A `fetch` that answers from a route table keyed `METHOD url`, consuming a
 * queue per route so a retry can be scripted, and records every pause the
 * probe asked for.
 */
function fakeFetch(routes: Record<string, Scripted | Scripted[]>): ProbeDeps & { calls: string[]; pauses: number[] } {
  const queues = new Map<string, Scripted[]>();
  for (const [key, value] of Object.entries(routes)) queues.set(key, Array.isArray(value) ? [...value] : [value]);
  const calls: string[] = [];
  const pauses: number[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push(key);
    const queue = queues.get(key);
    const next = queue?.shift();
    if (next === undefined) return new Response("not routed", { status: 404 });
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, pause: async (ms) => void pauses.push(ms), calls, pauses };
}

const json = (body: string, status = 200): Response => new Response(body, { status, headers: { "content-type": "application/json" } });
/** A well-formed handshake answer, for the cases whose point is not the body. */
const HANDSHAKE_OK = '{"jsonrpc":"2.0","id":1,"result":{"capabilities":{}}}';
/** An anonymous tools/list that lists three tools: the truly open case. */
const TOOLS_OK = '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"a"},{"name":"b"},{"name":"c"}]}}';
const OPEN_LISTED = { kind: "open", status: 200, via: "post", tools: { kind: "listed", count: 3 } } as const;

/**
 * The route table every open case starts from: a handshake that succeeds
 * and a tools/list that answers. The POST route is a queue, so a case that
 * needs the handshake retried prepends its failures.
 */
function openRoutes(first: Scripted[] = []): Record<string, Scripted | Scripted[]> {
  return { [`POST ${MCP_URL}`]: [...first, json(HANDSHAKE_OK), json(TOOLS_OK)] };
}
const status = (code: number, headers: Record<string, string> = {}, body = ""): Response => new Response(body, { status: code, headers });
/** An event stream that never ends: reading its body would hang the test, which is the point. */
const eventStream = (): Response => new Response(new ReadableStream({ start() {} }), { status: 200, headers: { "content-type": "text/event-stream" } });

describe("the runner's 401 rule, word for word", () => {
  it("calls a Bearer challenge OAuth when it names an OAuth realm or resource metadata", () => {
    expect(isOAuthChallenge('Bearer realm="OAuth"')).toBe(true);
    expect(isOAuthChallenge('Bearer resource_metadata="https://x.example/.well-known/oauth-protected-resource"')).toBe(true);
    expect(isOAuthChallenge(OAUTH_CHALLENGE)).toBe(true);
  });

  it("does not call a plain Bearer, an invalid-token Bearer, or a Basic challenge OAuth", () => {
    expect(isOAuthChallenge("Bearer")).toBe(false);
    expect(isOAuthChallenge('Bearer error="invalid_token", error_description="expired"')).toBe(false);
    expect(isOAuthChallenge('Basic realm="OAuth"')).toBe(false);
    expect(isOAuthChallenge("")).toBe(false);
  });

  it("extracts the resource_metadata pointer and nothing else", () => {
    expect(parseResourceMetadataUrl(OAUTH_CHALLENGE)).toBe("https://mcp.vendor.example/.well-known/oauth-protected-resource/mcp");
    expect(parseResourceMetadataUrl('Bearer realm="OAuth"')).toBeUndefined();
  });

  it("sends the runner's request shape with a complete initialize, so a server that validates before it authenticates reaches its auth check", () => {
    expect(INITIALIZE_REQUEST.method).toBe("POST");
    expect(INITIALIZE_REQUEST.headers.Accept).toBe("application/json, text/event-stream");
    expect(INITIALIZE_REQUEST.headers["MCP-Protocol-Version"]).toBe(MCP_PROTOCOL_VERSION);
    expect(JSON.parse(INITIALIZE_REQUEST.body)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "stigmer-catalogue-audit", version: "0" } },
    });
  });
});

describe("probeEndpoint", () => {
  it("a handshake result followed by an anonymous tools/list that answers is open, both requests in the evidence", async () => {
    const deps = fakeFetch(openRoutes());
    const result = await probeEndpoint(MCP_URL, deps);
    expect(result.outcome).toEqual(OPEN_LISTED);
    expect(result.evidence.map((step) => step.purpose)).toEqual(["initialize", "tools-list"]);
    expect(result.evidence[0]).toMatchObject({ method: "POST", url: MCP_URL, status: 200 });
    expect(deps.pauses).toEqual([]);
  });

  it("carries the session a stateful server issued on initialize into tools/list", async () => {
    let toolsHeaders: Record<string, string> | undefined;
    const base = fakeFetch({
      [`POST ${MCP_URL}`]: [status(200, { "content-type": "application/json", "mcp-session-id": "s-123" }, HANDSHAKE_OK), json(TOOLS_OK)],
    });
    const deps: ProbeDeps = {
      ...base,
      fetchImpl: async (input, init) => {
        if (JSON.parse(String(init?.body)).method === "tools/list") toolsHeaders = init?.headers as Record<string, string>;
        return base.fetchImpl(input, init);
      },
    };
    await probeEndpoint(MCP_URL, deps);
    expect(toolsHeaders?.["mcp-session-id"]).toBe("s-123");
  });

  it("a result streamed as an event is an open handshake too", async () => {
    const body = 'event: message\r\ndata: {"jsonrpc":"2.0","id":1,"result":{"capabilities":{}}}\r\n\r\n';
    const deps = fakeFetch({ [`POST ${MCP_URL}`]: [status(200, { "content-type": "text/event-stream" }, body), json(TOOLS_OK)] });
    const result = await probeEndpoint(MCP_URL, deps);
    expect(result.outcome).toEqual(OPEN_LISTED);
  });

  it("an open handshake whose tools/list draws an OAuth challenge is oauth, challenged at tools/list (Google's shape)", async () => {
    const deps = fakeFetch({
      [`POST ${MCP_URL}`]: [json(HANDSHAKE_OK), status(401, { "www-authenticate": OAUTH_CHALLENGE })],
      "GET https://mcp.vendor.example/.well-known/oauth-protected-resource/mcp": json(fixture("protected-resource.json")),
      "GET https://login.vendor.example/.well-known/oauth-authorization-server": json(fixture("authorization-server-dcr.json")),
    });
    const result = await probeEndpoint(MCP_URL, deps);
    expect(result.outcome).toMatchObject({ kind: "oauth", challengedAt: "tools/list", challenge: OAUTH_CHALLENGE });
    expect(result.evidence.map((step) => step.purpose)).toEqual(["initialize", "tools-list", "resource-metadata", "authorization-server-metadata"]);
  });

  it("an open handshake whose tools/list is refused with a JSON-RPC error stays open, with the server's words", async () => {
    const refused = '{"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"Server not initialized"}}';
    const deps = fakeFetch({ [`POST ${MCP_URL}`]: [json(HANDSHAKE_OK), json(refused)] });
    const result = await probeEndpoint(MCP_URL, deps);
    expect(result.outcome).toEqual({ kind: "open", status: 200, via: "post", tools: { kind: "refused", message: "Server not initialized" } });
  });

  it("a 200 carrying a JSON-RPC error is a rejected handshake with the server's words, never open", async () => {
    const google = '{"error":{"code":-32602,"message":"Missing protocol version for Initialize"},"id":1,"jsonrpc":"2.0"}';
    const result = await probeEndpoint(MCP_URL, fakeFetch({ [`POST ${MCP_URL}`]: json(google) }));
    expect(result.outcome).toEqual({ kind: "handshake-rejected", status: 200, message: "Missing protocol version for Initialize" });

    const streamed = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Invalid request parameters","data":""}}\n\n';
    const viaStream = await probeEndpoint(MCP_URL, fakeFetch({ [`POST ${MCP_URL}`]: status(200, { "content-type": "text/event-stream" }, streamed) }));
    expect(viaStream.outcome).toEqual({ kind: "handshake-rejected", status: 200, message: "Invalid request parameters" });
  });

  it("a 200 that is not a JSON-RPC answer at all is http-other", async () => {
    const result = await probeEndpoint(MCP_URL, fakeFetch({ [`POST ${MCP_URL}`]: status(200, { "content-type": "text/html" }, "<html>welcome</html>") }));
    expect(result.outcome).toEqual({ kind: "http-other", status: 200, via: "post" });
  });

  it("resolves an OAuth challenge through its pointer to a login server on another origin, with dynamic registration", async () => {
    const deps = fakeFetch({
      [`POST ${MCP_URL}`]: status(401, { "www-authenticate": OAUTH_CHALLENGE }),
      "GET https://mcp.vendor.example/.well-known/oauth-protected-resource/mcp": json(fixture("protected-resource.json")),
      "GET https://login.vendor.example/.well-known/oauth-authorization-server": json(fixture("authorization-server-dcr.json")),
    });
    const result = await probeEndpoint(MCP_URL, deps);
    expect(result.outcome).toMatchObject({
      kind: "oauth",
      challenge: OAUTH_CHALLENGE,
      resourceMetadataUrl: "https://mcp.vendor.example/.well-known/oauth-protected-resource/mcp",
      authorizationServer: {
        metadataUrl: "https://login.vendor.example/.well-known/oauth-authorization-server",
        issuer: "https://login.vendor.example",
        dynamicRegistration: true,
        loginOrigin: "other",
        pkceS256: true,
        scopesSupported: ["read", "write", "offline_access"],
      },
    });
    expect(result.evidence.map((step) => step.purpose)).toEqual(["initialize", "resource-metadata", "authorization-server-metadata"]);
    expect(result.evidence[0]?.wwwAuthenticate).toBe(OAUTH_CHALLENGE);
  });

  it("without a pointer, falls back to the well-known documents at the MCP origin and reports a pre-registered login server as such", async () => {
    const deps = fakeFetch({
      [`POST ${MCP_URL}`]: status(401, { "www-authenticate": 'Bearer realm="OAuth"' }),
      // No protected-resource document at either well-known path: the origin itself is the issuer.
      "GET https://mcp.vendor.example/.well-known/oauth-authorization-server": json(fixture("authorization-server-pre-registered.json")),
    });
    const result = await probeEndpoint(MCP_URL, deps);
    expect(result.outcome).toMatchObject({
      kind: "oauth",
      authorizationServer: { dynamicRegistration: false, loginOrigin: "same", pkceS256: true },
    });
    expect(result.outcome.kind === "oauth" && result.outcome.resourceMetadataUrl).toBeUndefined();
    expect(deps.calls).toEqual([
      `POST ${MCP_URL}`,
      "GET https://mcp.vendor.example/.well-known/oauth-protected-resource/mcp",
      "GET https://mcp.vendor.example/.well-known/oauth-protected-resource",
      "GET https://mcp.vendor.example/.well-known/oauth-authorization-server",
    ]);
  });

  it("tries OpenID's document when RFC 8414's is absent", async () => {
    const deps = fakeFetch({
      [`POST ${MCP_URL}`]: status(401, { "www-authenticate": OAUTH_CHALLENGE }),
      "GET https://mcp.vendor.example/.well-known/oauth-protected-resource/mcp": json(fixture("protected-resource.json")),
      "GET https://login.vendor.example/.well-known/openid-configuration": json(fixture("authorization-server-dcr.json")),
    });
    const result = await probeEndpoint(MCP_URL, deps);
    expect(result.outcome.kind).toBe("oauth");
    expect(result.outcome.kind === "oauth" && result.outcome.authorizationServer.metadataUrl).toBe("https://login.vendor.example/.well-known/openid-configuration");
  });

  it("an OAuth challenge whose metadata cannot be followed is oauth-unresolvable with the reason", async () => {
    const deps = fakeFetch({
      [`POST ${MCP_URL}`]: status(401, { "www-authenticate": OAUTH_CHALLENGE }),
      "GET https://mcp.vendor.example/.well-known/oauth-protected-resource/mcp": json('{"resource":"x"}'),
    });
    const result = await probeEndpoint(MCP_URL, deps);
    expect(result.outcome).toMatchObject({ kind: "oauth-unresolvable", challenge: OAUTH_CHALLENGE });
    expect(result.outcome.kind === "oauth-unresolvable" && result.outcome.reason).toContain("names no authorization_servers");
  });

  it("a 401 the runner would not call OAuth is challenge-not-oauth, and the ladder is not climbed", async () => {
    const deps = fakeFetch({ [`POST ${MCP_URL}`]: status(401, { "www-authenticate": 'Bearer error="invalid_token"' }) });
    const result = await probeEndpoint(MCP_URL, deps);
    expect(result.outcome).toEqual({ kind: "challenge-not-oauth", challengedAt: "initialize", challenge: 'Bearer error="invalid_token"' });
    expect(deps.calls).toHaveLength(1);
  });

  it("a 4xx other than 401 is followed by the event-stream GET; a stream is open via sse, and its body is never read", async () => {
    const deps = fakeFetch({ [`POST ${MCP_URL}`]: status(405), [`GET ${MCP_URL}`]: eventStream() });
    const result = await probeEndpoint(MCP_URL, deps);
    expect(result.outcome).toEqual({ kind: "open", status: 200, via: "sse", tools: { kind: "not-asked" } });
    expect(result.evidence.map((step) => step.purpose)).toEqual(["initialize", "sse"]);
  });

  it("a 4xx whose GET is not an event stream is http-other via sse, keeping the POST's status in the evidence", async () => {
    const deps = fakeFetch({ [`POST ${MCP_URL}`]: status(404), [`GET ${MCP_URL}`]: status(200, { "content-type": "text/html" }, "<html>") });
    const result = await probeEndpoint(MCP_URL, deps);
    expect(result.outcome).toEqual({ kind: "http-other", status: 200, via: "sse" });
    expect(result.evidence[0]?.status).toBe(404);
  });

  it("a 401 on the event-stream GET enters the same OAuth ladder", async () => {
    const deps = fakeFetch({
      [`POST ${MCP_URL}`]: status(405),
      [`GET ${MCP_URL}`]: status(401, { "www-authenticate": OAUTH_CHALLENGE }),
      "GET https://mcp.vendor.example/.well-known/oauth-protected-resource/mcp": json(fixture("protected-resource.json")),
      "GET https://login.vendor.example/.well-known/oauth-authorization-server": json(fixture("authorization-server-dcr.json")),
    });
    const result = await probeEndpoint(MCP_URL, deps);
    expect(result.outcome.kind).toBe("oauth");
  });

  it("a 403 whose GET also fails is http-other via post", async () => {
    const deps = fakeFetch({ [`POST ${MCP_URL}`]: status(403), [`GET ${MCP_URL}`]: [new Error("ECONNRESET"), new Error("ECONNRESET")] });
    const result = await probeEndpoint(MCP_URL, deps);
    // The GET's network failure is retried once, then the POST's 403 stands.
    expect(result.outcome).toEqual({ kind: "http-other", status: 403, via: "post" });
    expect(deps.pauses).toEqual([RETRY_PAUSE_MS]);
  });

  it("a 5xx is retried once after the fixed pause, and the retry is marked", async () => {
    const deps = fakeFetch(openRoutes([status(503)]));
    const result = await probeEndpoint(MCP_URL, deps);
    expect(result.outcome).toEqual(OPEN_LISTED);
    expect(deps.pauses).toEqual([RETRY_PAUSE_MS]);
    expect(result.evidence.map((step) => [step.purpose, step.status, step.retry ?? false])).toEqual([
      ["initialize", 503, false],
      ["initialize", 200, true],
      ["tools-list", 200, false],
    ]);
  });

  it("a 5xx twice is http-other", async () => {
    const deps = fakeFetch({ [`POST ${MCP_URL}`]: [status(502), status(502)] });
    const result = await probeEndpoint(MCP_URL, deps);
    expect(result.outcome).toEqual({ kind: "http-other", status: 502, via: "post" });
  });

  it("a network failure twice is unreachable with the error, both attempts in the evidence", async () => {
    const deps = fakeFetch({ [`POST ${MCP_URL}`]: [new TypeError("fetch failed"), new TypeError("fetch failed")] });
    const result = await probeEndpoint(MCP_URL, deps);
    expect(result.outcome).toEqual({ kind: "unreachable", error: "TypeError: fetch failed" });
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[1]).toMatchObject({ retry: true, error: "TypeError: fetch failed" });
  });

  it("a 429 waits the server's Retry-After, capped", async () => {
    const polite = fakeFetch(openRoutes([status(429, { "retry-after": "2" })]));
    await probeEndpoint(MCP_URL, polite);
    expect(polite.pauses).toEqual([2_000]);

    const greedy = fakeFetch(openRoutes([status(429, { "retry-after": "3600" })]));
    await probeEndpoint(MCP_URL, greedy);
    expect(greedy.pauses).toEqual([RETRY_AFTER_CAP_MS]);

    const dated = fakeFetch(openRoutes([status(429, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" })]));
    await probeEndpoint(MCP_URL, dated);
    expect(dated.pauses).toEqual([RETRY_PAUSE_MS]);
  });

  it("never follows a redirect and never sends a credential", async () => {
    const deps = fakeFetch({ [`POST ${MCP_URL}`]: status(302, { location: "https://elsewhere.example/" }) });
    const result = await probeEndpoint(MCP_URL, deps);
    expect(result.outcome).toEqual({ kind: "http-other", status: 302, via: "post" });
    expect(deps.calls).toEqual([`POST ${MCP_URL}`]);
  });
});

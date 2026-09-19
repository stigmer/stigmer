/**
 * Pins the one-request probe: the complete `initialize` body (the shape
 * several hosted servers demand before they authenticate), the caller's
 * headers and name carried, the closed outcome vocabulary, the body
 * released unread, and a failing fetch answered as `unreachable`.
 */
import { describe, expect, it } from "vitest";

import type { OutboundFetch } from "../egress/fetch.js";
import { probeEndpointAuth } from "../mcp-oauth/probe.js";
import { MCP_PROTOCOL_VERSION } from "../mcp-oauth/request.js";

const deps = { timeoutMs: 3_000, clientName: "stigmer-test" };

function answering(status: number, headers: Record<string, string> = {}, body: string | null = null): { fetchImpl: OutboundFetch; calls: { url: string; init: RequestInit | undefined }[] } {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl: OutboundFetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(body, { status, headers });
  };
  return { fetchImpl, calls };
}

describe("probeEndpointAuth", () => {
  it("sends one complete initialize, naming the caller, with the endpoint's headers layered on", async () => {
    const { fetchImpl, calls } = answering(200, {}, "{}");
    await probeEndpointAuth("https://mcp.vendor.test/mcp", { "X-Vendor": "v" }, { ...deps, fetchImpl });
    expect(calls).toHaveLength(1);
    const init = calls[0]?.init;
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Accept"]).toBe("application/json, text/event-stream");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["MCP-Protocol-Version"]).toBe(MCP_PROTOCOL_VERSION);
    expect(headers["X-Vendor"]).toBe("v");
    const body = JSON.parse(String(init?.body)) as { method: string; params: { protocolVersion: string; capabilities: object; clientInfo: { name: string } } };
    expect(body.method).toBe("initialize");
    expect(body.params.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(body.params.capabilities).toEqual({});
    expect(body.params.clientInfo.name).toBe("stigmer-test");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reads a 401 OAuth challenge as oauth with its resource_metadata pointer", async () => {
    const { fetchImpl } = answering(401, { "www-authenticate": 'Bearer realm="OAuth", resource_metadata="https://mcp.vendor.test/.well-known/oauth-protected-resource"' });
    await expect(probeEndpointAuth("https://mcp.vendor.test/mcp", undefined, { ...deps, fetchImpl })).resolves.toEqual({
      kind: "oauth",
      challenge: 'Bearer realm="OAuth", resource_metadata="https://mcp.vendor.test/.well-known/oauth-protected-resource"',
      resourceMetadataUrl: "https://mcp.vendor.test/.well-known/oauth-protected-resource",
    });
  });

  it("reads a 401 without a pointer as oauth when the realm says OAuth", async () => {
    const { fetchImpl } = answering(401, { "www-authenticate": 'Bearer realm="OAuth"' });
    await expect(probeEndpointAuth("https://mcp.vendor.test/mcp", undefined, { ...deps, fetchImpl })).resolves.toEqual({
      kind: "oauth",
      challenge: 'Bearer realm="OAuth"',
      resourceMetadataUrl: undefined,
    });
  });

  it("reads a plain Bearer 401 as challenge-not-oauth", async () => {
    const { fetchImpl } = answering(401, { "www-authenticate": 'Bearer error="invalid_token"' });
    await expect(probeEndpointAuth("https://api.vendor.test/mcp", undefined, { ...deps, fetchImpl })).resolves.toEqual({
      kind: "challenge-not-oauth",
      challenge: 'Bearer error="invalid_token"',
    });
  });

  it("reads a 401 without a WWW-Authenticate header as challenge-not-oauth with an empty challenge", async () => {
    const { fetchImpl } = answering(401);
    await expect(probeEndpointAuth("https://api.vendor.test/mcp", undefined, { ...deps, fetchImpl })).resolves.toEqual({ kind: "challenge-not-oauth", challenge: "" });
  });

  it("reads a 2xx as accepted whatever the body says, and releases the body", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl: OutboundFetch = async () => new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    await expect(probeEndpointAuth("https://open.vendor.test/mcp", undefined, { ...deps, fetchImpl })).resolves.toEqual({ kind: "accepted", status: 200 });
    expect(cancelled).toBe(true);
  });

  it("reads any other status as http-other", async () => {
    const { fetchImpl } = answering(405);
    await expect(probeEndpointAuth("https://api.vendor.test/mcp", undefined, { ...deps, fetchImpl })).resolves.toEqual({ kind: "http-other", status: 405 });
  });

  it("never throws: a failing fetch is unreachable, naming the error", async () => {
    const fetchImpl: OutboundFetch = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    await expect(probeEndpointAuth("http://127.0.0.1:9/mcp", undefined, { ...deps, fetchImpl })).resolves.toEqual({ kind: "unreachable", error: "Error: connect ECONNREFUSED" });
  });
});

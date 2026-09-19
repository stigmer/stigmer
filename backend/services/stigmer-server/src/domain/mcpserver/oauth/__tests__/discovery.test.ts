/**
 * Pins authorization-server discovery: for an MCP endpoint the RFC 9728
 * walk (the protected-resource document names the login server, which may
 * live on another origin and carry a path) with the endpoint's origin as
 * the last resort the retired reader used; for an author's `discovery_url`
 * an issuer read; S256 mandatory when advertised; and every error message
 * verbatim, because initiate embeds it in its FailedPrecondition copy and
 * the conformance suite pins it against the first document tried.
 */
import { describe, expect, it } from "vitest";

import type { OutboundFetch } from "@stigmer/outbound/egress";

import { buildWellKnownUrl, discoverAtIssuer, discoverForResource } from "../discovery.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const VALID_METADATA = {
  issuer: "https://auth.example.com",
  authorization_endpoint: "https://auth.example.com/authorize",
  token_endpoint: "https://auth.example.com/token",
  registration_endpoint: "https://auth.example.com/register",
  scopes_supported: ["read", "write"],
  code_challenge_methods_supported: ["S256"],
};

/** A fetch answering from a URL table; anything unlisted is a 404. */
function serving(documents: Record<string, unknown>): { fetchImpl: OutboundFetch; requested: string[]; accepts: string[] } {
  const requested: string[] = [];
  const accepts: string[] = [];
  const fetchImpl: OutboundFetch = async (url, init) => {
    requested.push(String(url));
    accepts.push((init?.headers as Record<string, string>)["Accept"] ?? "");
    const body = documents[String(url)];
    return body === undefined ? jsonResponse(404, {}) : jsonResponse(200, body);
  };
  return { fetchImpl, requested, accepts };
}

describe("buildWellKnownUrl", () => {
  it("builds at the origin, dropping the server path (Linear-style URL)", () => {
    expect(buildWellKnownUrl("https://mcp.linear.app/mcp")).toBe("https://mcp.linear.app/.well-known/oauth-authorization-server");
  });

  it("preserves a non-default port in the origin", () => {
    expect(buildWellKnownUrl("http://127.0.0.1:8931/api/v2")).toBe("http://127.0.0.1:8931/.well-known/oauth-authorization-server");
  });

  const invalid: Array<[string, string, string]> = [
    ["a non-http(s) scheme", "ftp://example.com", 'invalid server URL for discovery: unsupported scheme "ftp": only http and https are supported'],
  ];
  it.each(invalid)("rejects %s", (_label, url, message) => {
    expect(() => buildWellKnownUrl(url)).toThrow(message);
  });

  it("rejects an unparseable URL with the Go prefix", () => {
    expect(() => buildWellKnownUrl("::::")).toThrow(/^invalid server URL for discovery: /);
  });
});

describe("discoverForResource", () => {
  it("reaches a login server on another origin through the protected-resource document (RFC 9728)", async () => {
    const { fetchImpl, requested } = serving({
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp": { resource: "https://mcp.example.com/mcp", authorization_servers: ["https://auth.example.com"] },
      "https://auth.example.com/.well-known/oauth-authorization-server": VALID_METADATA,
    });
    const metadata = await discoverForResource("https://mcp.example.com/mcp", fetchImpl);
    expect(metadata.authorizationEndpoint).toBe("https://auth.example.com/authorize");
    expect(metadata.registrationEndpoint).toBe("https://auth.example.com/register");
    expect(requested).toEqual([
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
      "https://auth.example.com/.well-known/oauth-authorization-server",
    ]);
  });

  it("inserts the well-known segment before an issuer's path (RFC 8414 section 3)", async () => {
    const { fetchImpl } = serving({
      "https://mcp.example.com/.well-known/oauth-protected-resource": { authorization_servers: ["https://auth.example.com/tenant"] },
      "https://auth.example.com/.well-known/oauth-authorization-server/tenant": VALID_METADATA,
    });
    const metadata = await discoverForResource("https://mcp.example.com/", fetchImpl);
    expect(metadata.tokenEndpoint).toBe("https://auth.example.com/token");
  });

  it("falls back to the endpoint's origin when no protected-resource document exists, sending Accept: application/json", async () => {
    const { fetchImpl, requested, accepts } = serving({
      "https://mcp.example.com/.well-known/oauth-authorization-server": VALID_METADATA,
    });
    const metadata = await discoverForResource("https://mcp.example.com/mcp", fetchImpl);
    expect(metadata.scopesSupported).toEqual(["read", "write"]);
    expect(requested).toEqual([
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
      "https://mcp.example.com/.well-known/oauth-protected-resource",
      "https://mcp.example.com/.well-known/oauth-authorization-server",
    ]);
    expect(new Set(accepts)).toEqual(new Set(["application/json"]));
  });

  it("refuses a non-200 naming the origin's RFC 8414 document with the MCP Authorization hint (Go copy, verbatim)", async () => {
    const fetchImpl: OutboundFetch = async () => jsonResponse(404, {});
    await expect(discoverForResource("https://mcp.example.com/mcp", fetchImpl)).rejects.toThrow(
      "authorization server discovery failed: https://mcp.example.com/.well-known/oauth-authorization-server returned HTTP 404 (expected 200). " +
        "This MCP server may not support the MCP Authorization specification",
    );
  });

  it("wraps a network failure with the discovery-request prefix", async () => {
    const fetchImpl: OutboundFetch = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    await expect(discoverForResource("https://mcp.example.com/mcp", fetchImpl)).rejects.toThrow(/^discovery request to .* failed: connect ECONNREFUSED$/);
  });

  it("screens the URL before dialling", async () => {
    const fetchImpl: OutboundFetch = async () => jsonResponse(200, VALID_METADATA);
    await expect(discoverForResource("ftp://example.com", fetchImpl)).rejects.toThrow(
      'invalid server URL for discovery: unsupported scheme "ftp": only http and https are supported',
    );
  });
});

describe("discoverAtIssuer", () => {
  it("reads an author's discovery_url as an issuer, RFC 8414 at its origin first", async () => {
    const { fetchImpl, requested } = serving({
      "https://auth.example.com/.well-known/oauth-authorization-server": VALID_METADATA,
    });
    const metadata = await discoverAtIssuer("https://auth.example.com", fetchImpl);
    expect(metadata.authorizationEndpoint).toBe("https://auth.example.com/authorize");
    expect(requested).toEqual(["https://auth.example.com/.well-known/oauth-authorization-server"]);
  });

  it("falls back to OpenID's document", async () => {
    const { fetchImpl, requested } = serving({
      "https://auth.example.com/.well-known/openid-configuration": VALID_METADATA,
    });
    await discoverAtIssuer("https://auth.example.com", fetchImpl);
    expect(requested).toEqual([
      "https://auth.example.com/.well-known/oauth-authorization-server",
      "https://auth.example.com/.well-known/openid-configuration",
    ]);
  });

  it("refuses a non-200 naming the first document tried with its status (the conformance suite's pin)", async () => {
    const fetchImpl: OutboundFetch = async () => jsonResponse(503, { error: "metadata unavailable" });
    await expect(discoverAtIssuer("http://127.0.0.1:8931", fetchImpl)).rejects.toThrow(
      "authorization server discovery failed: http://127.0.0.1:8931/.well-known/oauth-authorization-server returned HTTP 503 (expected 200). " +
        "This MCP server may not support the MCP Authorization specification",
    );
  });

  const missingEndpoint: Array<[string, Record<string, unknown>, string]> = [
    ["authorization_endpoint", { ...VALID_METADATA, authorization_endpoint: undefined }, "is missing authorization_endpoint"],
    ["token_endpoint", { ...VALID_METADATA, token_endpoint: undefined }, "is missing token_endpoint"],
  ];
  it.each(missingEndpoint)("refuses metadata without %s, naming the document (Go copy)", async (_label, body, fragment) => {
    const fetchImpl: OutboundFetch = async () => jsonResponse(200, body);
    await expect(discoverAtIssuer("https://auth.example.com", fetchImpl)).rejects.toThrow(
      `authorization server at https://auth.example.com/.well-known/oauth-authorization-server ${fragment}`,
    );
  });

  it("refuses a server that advertises methods without S256 (Go %v list rendering)", async () => {
    const fetchImpl: OutboundFetch = async () => jsonResponse(200, { ...VALID_METADATA, code_challenge_methods_supported: ["plain"] });
    await expect(discoverAtIssuer("https://auth.example.com", fetchImpl)).rejects.toThrow(
      "does not support S256 PKCE (supports: [plain]). S256 is required by the MCP Authorization specification",
    );
  });

  it("accepts a server that advertises NO methods (list absent = unconstrained)", async () => {
    const fetchImpl: OutboundFetch = async () => jsonResponse(200, { ...VALID_METADATA, code_challenge_methods_supported: undefined });
    const metadata = await discoverAtIssuer("https://auth.example.com", fetchImpl);
    expect(metadata.codeChallengeMethodsSupported).toEqual([]);
  });
});

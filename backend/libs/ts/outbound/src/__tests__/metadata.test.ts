/**
 * Pins the login-server walk: the RFC 9728 documents tried most specific
 * first, the RFC 8414 well-known segment inserted BEFORE an issuer's path,
 * OpenID's document as the fallback, the challenge's pointer preferred, and
 * every attempt recorded so a caller can name the document it failed on.
 */
import { describe, expect, it } from "vitest";

import type { OutboundFetch } from "../egress/fetch.js";
import {
  authorizationServerMetadataUrls,
  protectedResourceMetadataUrls,
  readAuthorizationServerMetadata,
  resolveAuthorizationServers,
} from "../mcp-oauth/metadata.js";

const deps = { timeoutMs: 1_000 };

function serving(documents: Record<string, unknown | { status: number; body?: unknown }>): { fetchImpl: OutboundFetch; requested: string[] } {
  const requested: string[] = [];
  const fetchImpl: OutboundFetch = async (url) => {
    const key = String(url);
    requested.push(key);
    const entry = documents[key];
    if (entry === undefined) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    if (typeof entry === "object" && entry !== null && "status" in entry && typeof (entry as { status: unknown }).status === "number") {
      const { status, body } = entry as { status: number; body?: unknown };
      return new Response(body === undefined ? null : JSON.stringify(body), { status });
    }
    return new Response(JSON.stringify(entry), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, requested };
}

const ISSUER_DOCUMENT = {
  issuer: "https://login.vendor.test",
  authorization_endpoint: "https://login.vendor.test/authorize",
  token_endpoint: "https://login.vendor.test/token",
  registration_endpoint: "https://login.vendor.test/register",
  scopes_supported: ["read"],
  code_challenge_methods_supported: ["S256"],
};

describe("protectedResourceMetadataUrls", () => {
  it("tries the path-suffixed document first, then the bare one", () => {
    expect(protectedResourceMetadataUrls(new URL("https://mcp.vendor.test/mcp/"))).toEqual([
      "https://mcp.vendor.test/.well-known/oauth-protected-resource/mcp",
      "https://mcp.vendor.test/.well-known/oauth-protected-resource",
    ]);
  });

  it("tries only the bare document for a root resource", () => {
    expect(protectedResourceMetadataUrls(new URL("https://mcp.vendor.test/"))).toEqual(["https://mcp.vendor.test/.well-known/oauth-protected-resource"]);
  });
});

describe("authorizationServerMetadataUrls", () => {
  it("inserts the well-known segment before an issuer's path (RFC 8414 section 3), then falls back", () => {
    expect(authorizationServerMetadataUrls(new URL("https://login.vendor.test/tenant"))).toEqual([
      "https://login.vendor.test/.well-known/oauth-authorization-server/tenant",
      "https://login.vendor.test/.well-known/oauth-authorization-server",
      "https://login.vendor.test/tenant/.well-known/openid-configuration",
      "https://login.vendor.test/.well-known/openid-configuration",
    ]);
  });

  it("for a bare issuer tries RFC 8414 at the origin first, the document the reader before this one read", () => {
    expect(authorizationServerMetadataUrls(new URL("https://mcp.vendor.test"))).toEqual([
      "https://mcp.vendor.test/.well-known/oauth-authorization-server",
      "https://mcp.vendor.test/.well-known/openid-configuration",
    ]);
  });
});

describe("resolveAuthorizationServers", () => {
  it("prefers the challenge's pointer and reads authorization_servers from it", async () => {
    const { fetchImpl, requested } = serving({
      "https://mcp.vendor.test/.well-known/oauth-protected-resource/mcp": { resource: "https://mcp.vendor.test/mcp", authorization_servers: ["https://login.vendor.test"] },
    });
    const result = await resolveAuthorizationServers("https://mcp.vendor.test/mcp", "https://mcp.vendor.test/.well-known/oauth-protected-resource/mcp", { ...deps, fetchImpl });
    expect(result.issuers).toEqual(["https://login.vendor.test"]);
    expect(requested).toEqual(["https://mcp.vendor.test/.well-known/oauth-protected-resource/mcp"]);
  });

  it("without a pointer walks the well-known documents most specific first", async () => {
    const { fetchImpl, requested } = serving({
      "https://mcp.vendor.test/.well-known/oauth-protected-resource": { authorization_servers: ["https://login.vendor.test/tenant"] },
    });
    const result = await resolveAuthorizationServers("https://mcp.vendor.test/mcp", undefined, { ...deps, fetchImpl });
    expect(result.issuers).toEqual(["https://login.vendor.test/tenant"]);
    expect(requested).toEqual(["https://mcp.vendor.test/.well-known/oauth-protected-resource/mcp", "https://mcp.vendor.test/.well-known/oauth-protected-resource"]);
    expect(result.attempts).toEqual([
      { url: "https://mcp.vendor.test/.well-known/oauth-protected-resource/mcp", status: 404 },
      { url: "https://mcp.vendor.test/.well-known/oauth-protected-resource", status: 200 },
    ]);
  });

  it("answers no issuers when no document names any, recording every attempt", async () => {
    const { fetchImpl } = serving({});
    const result = await resolveAuthorizationServers("https://mcp.vendor.test/mcp", undefined, { ...deps, fetchImpl });
    expect(result.issuers).toEqual([]);
    expect(result.attempts).toHaveLength(2);
  });

  it("records a network failure as an attempt and moves on", async () => {
    const fetchImpl: OutboundFetch = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const result = await resolveAuthorizationServers("https://mcp.vendor.test/", undefined, { ...deps, fetchImpl });
    expect(result.issuers).toEqual([]);
    expect(result.attempts).toEqual([{ url: "https://mcp.vendor.test/.well-known/oauth-protected-resource", error: "connect ECONNREFUSED" }]);
  });
});

describe("readAuthorizationServerMetadata", () => {
  it("reads a path-bearing issuer through the inserted well-known segment", async () => {
    const { fetchImpl, requested } = serving({
      "https://login.vendor.test/.well-known/oauth-authorization-server/tenant": ISSUER_DOCUMENT,
    });
    const read = await readAuthorizationServerMetadata("https://login.vendor.test/tenant", { ...deps, fetchImpl });
    expect(read.kind).toBe("found");
    if (read.kind === "found") {
      expect(read.metadata).toEqual({
        metadataUrl: "https://login.vendor.test/.well-known/oauth-authorization-server/tenant",
        issuer: "https://login.vendor.test",
        authorizationEndpoint: "https://login.vendor.test/authorize",
        tokenEndpoint: "https://login.vendor.test/token",
        registrationEndpoint: "https://login.vendor.test/register",
        scopesSupported: ["read"],
        codeChallengeMethodsSupported: ["S256"],
      });
    }
    expect(requested).toEqual(["https://login.vendor.test/.well-known/oauth-authorization-server/tenant"]);
  });

  it("falls back to OpenID's document and reads an absent registration_endpoint as empty", async () => {
    const { fetchImpl, requested } = serving({
      "https://login.vendor.test/.well-known/openid-configuration": { ...ISSUER_DOCUMENT, registration_endpoint: undefined, scopes_supported: undefined },
    });
    const read = await readAuthorizationServerMetadata("https://login.vendor.test", { ...deps, fetchImpl });
    expect(read.kind).toBe("found");
    if (read.kind === "found") {
      expect(read.metadata.registrationEndpoint).toBe("");
      expect(read.metadata.scopesSupported).toEqual([]);
      expect(read.metadata.metadataUrl).toBe("https://login.vendor.test/.well-known/openid-configuration");
    }
    expect(requested).toEqual(["https://login.vendor.test/.well-known/oauth-authorization-server", "https://login.vendor.test/.well-known/openid-configuration"]);
  });

  it("skips a document that lacks either endpoint and reports not-found with every attempt", async () => {
    const { fetchImpl } = serving({
      "https://login.vendor.test/.well-known/oauth-authorization-server": { issuer: "x", authorization_endpoint: "https://login.vendor.test/authorize" },
      "https://login.vendor.test/.well-known/openid-configuration": { status: 503 },
    });
    const read = await readAuthorizationServerMetadata("https://login.vendor.test", { ...deps, fetchImpl });
    expect(read).toEqual({
      kind: "not-found",
      attempts: [
        { url: "https://login.vendor.test/.well-known/oauth-authorization-server", status: 200, missing: "token_endpoint" },
        { url: "https://login.vendor.test/.well-known/openid-configuration", status: 503 },
      ],
    });
  });

  it("reports not-found for an unparseable issuer without dialling", async () => {
    const { fetchImpl, requested } = serving({});
    const read = await readAuthorizationServerMetadata("::::", { ...deps, fetchImpl });
    expect(read).toEqual({ kind: "not-found", attempts: [] });
    expect(requested).toEqual([]);
  });
});

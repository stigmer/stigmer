/**
 * Pins RFC 8414 discovery against Go oauth/discovery.go: the well-known
 * URI lives at the URL ORIGIN (not under the server's path), S256 support
 * is mandatory when advertised, and every error message is text initiate
 * embeds in its FailedPrecondition copy — asserted verbatim.
 */
import { describe, expect, it } from "vitest";

import { buildWellKnownUrl, discoverAuthorizationServer } from "../discovery.js";

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

describe("buildWellKnownUrl", () => {
  it("builds at the origin, dropping the server path (Linear-style URL)", () => {
    expect(buildWellKnownUrl("https://mcp.linear.app/mcp")).toBe(
      "https://mcp.linear.app/.well-known/oauth-authorization-server",
    );
  });

  it("preserves a non-default port in the origin", () => {
    expect(buildWellKnownUrl("http://127.0.0.1:8931/api/v2")).toBe(
      "http://127.0.0.1:8931/.well-known/oauth-authorization-server",
    );
  });

  const invalid: Array<[string, string, string]> = [
    [
      "a non-http(s) scheme",
      "ftp://example.com",
      'invalid server URL for discovery: unsupported scheme "ftp": only http and https are supported',
    ],
  ];
  it.each(invalid)("rejects %s", (_label, url, message) => {
    expect(() => buildWellKnownUrl(url)).toThrow(message);
  });

  it("rejects an unparseable URL with the Go prefix", () => {
    expect(() => buildWellKnownUrl("::::")).toThrow(
      /^invalid server URL for discovery: /,
    );
  });
});

describe("discoverAuthorizationServer", () => {
  it("parses valid metadata and sends Accept: application/json to the origin well-known URI", async () => {
    let requestedUrl = "";
    let accept = "";
    const metadata = await discoverAuthorizationServer(
      "https://mcp.example.com/mcp",
      async (url, init) => {
        requestedUrl = String(url);
        accept = (init?.headers as Record<string, string>)["Accept"] ?? "";
        return jsonResponse(200, VALID_METADATA);
      },
    );
    expect(requestedUrl).toBe(
      "https://mcp.example.com/.well-known/oauth-authorization-server",
    );
    expect(accept).toBe("application/json");
    expect(metadata.authorizationEndpoint).toBe(
      "https://auth.example.com/authorize",
    );
    expect(metadata.tokenEndpoint).toBe("https://auth.example.com/token");
    expect(metadata.registrationEndpoint).toBe(
      "https://auth.example.com/register",
    );
    expect(metadata.scopesSupported).toEqual(["read", "write"]);
  });

  it("refuses a non-200 with the MCP Authorization hint (Go copy, verbatim)", async () => {
    await expect(
      discoverAuthorizationServer("https://mcp.example.com/mcp", async () =>
        jsonResponse(404, {}),
      ),
    ).rejects.toThrow(
      "authorization server discovery failed: https://mcp.example.com/.well-known/oauth-authorization-server returned HTTP 404 (expected 200). " +
        "This MCP server may not support the MCP Authorization specification",
    );
  });

  const missingEndpoint: Array<[string, Record<string, unknown>, string]> = [
    [
      "authorization_endpoint",
      { ...VALID_METADATA, authorization_endpoint: undefined },
      "is missing authorization_endpoint",
    ],
    [
      "token_endpoint",
      { ...VALID_METADATA, token_endpoint: undefined },
      "is missing token_endpoint",
    ],
  ];
  it.each(missingEndpoint)(
    "refuses metadata without %s",
    async (_label, body, fragment) => {
      await expect(
        discoverAuthorizationServer("https://mcp.example.com/mcp", async () =>
          jsonResponse(200, body),
        ),
      ).rejects.toThrow(fragment);
    },
  );

  it("refuses a server that advertises methods without S256 (Go %v list rendering)", async () => {
    await expect(
      discoverAuthorizationServer("https://mcp.example.com/mcp", async () =>
        jsonResponse(200, {
          ...VALID_METADATA,
          code_challenge_methods_supported: ["plain"],
        }),
      ),
    ).rejects.toThrow(
      "does not support S256 PKCE (supports: [plain]). S256 is required by the MCP Authorization specification",
    );
  });

  it("accepts a server that advertises NO methods (list absent = unconstrained)", async () => {
    const metadata = await discoverAuthorizationServer(
      "https://mcp.example.com/mcp",
      async () =>
        jsonResponse(200, {
          ...VALID_METADATA,
          code_challenge_methods_supported: undefined,
        }),
    );
    expect(metadata.codeChallengeMethodsSupported).toEqual([]);
  });

  it("wraps a network failure with the discovery-request prefix", async () => {
    await expect(
      discoverAuthorizationServer("https://mcp.example.com/mcp", async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    ).rejects.toThrow(/^discovery request to .* failed: connect ECONNREFUSED$/);
  });
});

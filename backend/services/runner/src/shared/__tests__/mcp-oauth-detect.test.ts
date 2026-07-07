/**
 * Unit tests for the HTTP MCP OAuth-challenge classifier.
 *
 * Verifies that `detectOAuthChallenge` recognizes a real MCP OAuth challenge
 * (401 + `WWW-Authenticate: Bearer ...` per RFC 9728), and does NOT misfire on
 * a plain invalid-token 401, a success, a non-OAuth error, or a network fault —
 * so it can only ever turn an opaque failure into a clearer one, never mask a
 * different cause.
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import {
  OAuthRequiredError,
  detectOAuthChallenge,
  isOAuthChallenge,
  parseResourceMetadataUrl,
} from "../mcp-oauth-detect.js";

function mockFetchOnce(response: {
  status: number;
  wwwAuthenticate?: string;
}): void {
  const headers = new Headers();
  if (response.wwwAuthenticate !== undefined) {
    headers.set("www-authenticate", response.wwwAuthenticate);
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(null, { status: response.status, headers }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isOAuthChallenge", () => {
  it("matches the MCP auth spec Bearer + OAuth realm challenge", () => {
    expect(
      isOAuthChallenge('Bearer realm="OAuth", resource_metadata="https://x/.well-known/oauth-protected-resource"'),
    ).toBe(true);
  });

  it("matches a Bearer challenge that only advertises resource_metadata", () => {
    expect(
      isOAuthChallenge('Bearer resource_metadata="https://x/.well-known/oauth-protected-resource"'),
    ).toBe(true);
  });

  it("does not match a plain Bearer 401 (invalid API key, not an OAuth requirement)", () => {
    expect(isOAuthChallenge('Bearer error="invalid_token"')).toBe(false);
  });

  it("does not match a non-Bearer scheme", () => {
    expect(isOAuthChallenge('Basic realm="oauth"')).toBe(false);
  });

  it("is empty-safe", () => {
    expect(isOAuthChallenge("")).toBe(false);
  });
});

describe("parseResourceMetadataUrl", () => {
  it("extracts the resource_metadata URL", () => {
    expect(
      parseResourceMetadataUrl(
        'Bearer realm="OAuth", resource_metadata="https://mcp.notion.com/.well-known/oauth-protected-resource/mcp"',
      ),
    ).toBe("https://mcp.notion.com/.well-known/oauth-protected-resource/mcp");
  });

  it("returns undefined when absent", () => {
    expect(parseResourceMetadataUrl('Bearer realm="OAuth"')).toBeUndefined();
  });
});

describe("detectOAuthChallenge", () => {
  it("returns an OAuthRequiredError for a 401 OAuth challenge", async () => {
    mockFetchOnce({
      status: 401,
      wwwAuthenticate:
        'Bearer realm="OAuth", resource_metadata="https://mcp.notion.com/.well-known/oauth-protected-resource/mcp"',
    });

    const result = await detectOAuthChallenge("https://mcp.notion.com/mcp", {}, "notion");

    expect(result).toBeInstanceOf(OAuthRequiredError);
    expect(result?.serverSlug).toBe("notion");
    expect(result?.resourceMetadataUrl).toBe(
      "https://mcp.notion.com/.well-known/oauth-protected-resource/mcp",
    );
    // The message is self-contained and carries the "requires OAuth" marker the
    // connect wrappers key on.
    expect(result?.message).toContain("requires OAuth");
    expect(result?.message).toContain("notion");
  });

  it("returns null for a 401 that is NOT an OAuth challenge (invalid static token)", async () => {
    mockFetchOnce({ status: 401, wwwAuthenticate: 'Bearer error="invalid_token"' });
    expect(
      await detectOAuthChallenge("https://api.example.com/mcp", {}, "example"),
    ).toBeNull();
  });

  it("returns null on a non-401 response", async () => {
    mockFetchOnce({ status: 200 });
    expect(
      await detectOAuthChallenge("https://api.example.com/mcp", {}, "example"),
    ).toBeNull();
  });

  it("returns null (never throws) when the probe itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(
      await detectOAuthChallenge("https://api.example.com/mcp", {}, "example"),
    ).toBeNull();
  });

  it("forwards the resolved headers to the probe request", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await detectOAuthChallenge(
      "https://api.example.com/mcp",
      { Authorization: "Bearer stale-token" },
      "example",
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer stale-token",
    );
    expect(init?.method).toBe("POST");
  });
});

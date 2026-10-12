/**
 * Pins the shared discovery reader: the document URL (OIDC Discovery §4,
 * trailing slashes tolerated), the facts it reads from a provider's
 * discovery document, every URL the document names at its top level, and one value per
 * failure, never a throw: unreachable with its cause, an error status, a
 * body that is not a JSON object, no issuer, no jwks_uri. Each caller's
 * policy over those values is pinned beside the caller (the identity
 * provider's in `iam/provider/__tests__/handlers.test.ts`, a host's own
 * lanes in its own suites).
 */
import { describe, expect, it } from "vitest";

import { discoveryUrl, readDiscoveryDocument } from "../oidc-discovery.js";

const ISSUER = "https://idp.example.test/";
const URL_OF = "https://idp.example.test/.well-known/openid-configuration";

function serving(body: string, status = 200): typeof fetch {
  return ((input: string | URL | Request) => {
    expect(String(input)).toBe(URL_OF);
    return Promise.resolve(new Response(body, { status }));
  }) as typeof fetch;
}

const read = (fetchImpl: typeof fetch) => readDiscoveryDocument(ISSUER, { fetchImpl, timeoutMs: 1_000 });

describe("discoveryUrl", () => {
  it("appends the well-known path to the issuer without its trailing slashes", () => {
    expect(discoveryUrl("https://login.example.test/oauth2/default")).toBe(
      "https://login.example.test/oauth2/default/.well-known/openid-configuration",
    );
    expect(discoveryUrl(ISSUER)).toBe(URL_OF);
    expect(discoveryUrl("https://idp.example.test///")).toBe(URL_OF);
  });

  it("reads an issuer with a long run of slashes inside it in linear time", () => {
    // A provider's issuer is written by an organization admin. A pattern that
    // backtracks over a run of slashes not at the end would cost the square
    // of its length; the contract's 2048-character bound only caps the cost.
    const issuer = `https://idp.example.test/${"/".repeat(50_000)}x`;
    const started = performance.now();
    expect(discoveryUrl(issuer)).toBe(`${issuer}/.well-known/openid-configuration`);
    expect(performance.now() - started).toBeLessThan(250);
  });
});

describe("readDiscoveryDocument", () => {
  it("reads the issuer as published, the key set, the userinfo endpoint, and every URL named", async () => {
    const outcome = await read(
      serving(
        JSON.stringify({
          issuer: ISSUER,
          authorization_endpoint: "https://idp.example.test/authorize",
          token_endpoint: "https://idp.example.test/oauth/token",
          userinfo_endpoint: "https://idp.example.test/userinfo",
          jwks_uri: "https://idp.example.test/.well-known/jwks.json",
          scopes_supported: ["openid"],
          request_uri_parameter_supported: false,
        }),
      ),
    );
    expect(outcome).toEqual({
      kind: "document",
      url: URL_OF,
      document: {
        issuer: ISSUER,
        jwksUri: "https://idp.example.test/.well-known/jwks.json",
        userinfoEndpoint: "https://idp.example.test/userinfo",
        endpoints: [
          ISSUER,
          "https://idp.example.test/authorize",
          "https://idp.example.test/oauth/token",
          "https://idp.example.test/userinfo",
          "https://idp.example.test/.well-known/jwks.json",
        ],
      },
    });
  });

  it("answers an absent userinfo endpoint as undefined", async () => {
    const outcome = await read(serving(JSON.stringify({ issuer: ISSUER, jwks_uri: `${ISSUER}jwks` })));
    expect(outcome.kind === "document" && outcome.document.userinfoEndpoint).toBeUndefined();
  });

  it("answers each failure as a value", async () => {
    const cause = new TypeError("fetch failed");
    expect(await read((() => Promise.reject(cause)) as typeof fetch)).toEqual({
      kind: "unreachable",
      url: URL_OF,
      cause,
    });
    expect(await read(serving("gone", 404))).toEqual({ kind: "status", url: URL_OF, status: 404 });
    expect(await read(serving("<html>"))).toEqual({ kind: "malformed", url: URL_OF, missing: "json" });
    expect(await read(serving("[]"))).toEqual({ kind: "malformed", url: URL_OF, missing: "json" });
    expect(await read(serving(JSON.stringify({ jwks_uri: "https://x.test/jwks" })))).toEqual({
      kind: "malformed",
      url: URL_OF,
      missing: "issuer",
    });
    expect(await read(serving(JSON.stringify({ issuer: ISSUER })))).toEqual({
      kind: "malformed",
      url: URL_OF,
      missing: "jwks_uri",
    });
  });
});

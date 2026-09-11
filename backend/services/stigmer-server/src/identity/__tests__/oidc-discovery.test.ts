/**
 * Pins the shared OIDC discovery reader (oidc-discovery.ts; 20260911.11
 * A8): the verifier's validation rules kept (issuer must match exactly,
 * jwks_uri required), userinfo_endpoint carried when present and absent
 * otherwise, one fetch per issuer after a success, and a failure that is
 * NOT cached so a flaky IdP at boot cannot brick a lane. The fetch is
 * injected; nothing dials out.
 */
import { describe, expect, it } from "vitest";

import { discoveryUrl, newIssuerDiscovery } from "../oidc-discovery.js";

const ISSUER = "https://issuer.test";

function fetchAnswering(
  answers: Array<{ status: number; body?: unknown }>,
): typeof fetch & { urls: string[] } {
  const urls: string[] = [];
  const impl = async (input: string | URL | Request): Promise<Response> => {
    urls.push(String(input));
    const next = answers.shift();
    if (next === undefined) {
      throw new Error("no scripted answer left");
    }
    return new Response(
      next.body === undefined ? null : JSON.stringify(next.body),
      { status: next.status },
    );
  };
  return Object.assign(impl as typeof fetch, { urls });
}

describe("newIssuerDiscovery", () => {
  it("reads the well-known document once per issuer and carries the three endpoints", async () => {
    const fetchImpl = fetchAnswering([
      {
        status: 200,
        body: {
          issuer: ISSUER,
          jwks_uri: `${ISSUER}/jwks`,
          userinfo_endpoint: `${ISSUER}/userinfo`,
        },
      },
    ]);
    const discovery = newIssuerDiscovery(fetchImpl);

    const first = await discovery.discover(ISSUER);
    const second = await discovery.discover(ISSUER);

    expect(first).toEqual({
      issuer: ISSUER,
      jwksUri: `${ISSUER}/jwks`,
      userinfoEndpoint: `${ISSUER}/userinfo`,
    });
    expect(second).toBe(first);
    expect(fetchImpl.urls).toEqual([discoveryUrl(ISSUER)]);
  });

  it("strips one trailing slash from the issuer when forming the well-known URL", () => {
    expect(discoveryUrl("https://issuer.test/")).toBe(
      "https://issuer.test/.well-known/openid-configuration",
    );
  });

  it("carries no userinfo endpoint when the document names none — the consumer decides", async () => {
    const discovery = newIssuerDiscovery(
      fetchAnswering([
        { status: 200, body: { issuer: ISSUER, jwks_uri: `${ISSUER}/jwks` } },
      ]),
    );
    expect((await discovery.discover(ISSUER)).userinfoEndpoint).toBeUndefined();
  });

  it("refuses a document that names another issuer (RFC 8414 §3.3)", async () => {
    const discovery = newIssuerDiscovery(
      fetchAnswering([
        {
          status: 200,
          body: { issuer: "https://elsewhere.test", jwks_uri: "x" },
        },
      ]),
    );
    await expect(discovery.discover(ISSUER)).rejects.toThrow(
      "does not match configured issuer",
    );
  });

  it("refuses a document with no jwks_uri", async () => {
    const discovery = newIssuerDiscovery(
      fetchAnswering([{ status: 200, body: { issuer: ISSUER } }]),
    );
    await expect(discovery.discover(ISSUER)).rejects.toThrow(
      "carries no jwks_uri",
    );
  });

  it("does not cache a failure: the next call fetches again", async () => {
    const fetchImpl = fetchAnswering([
      { status: 503 },
      { status: 200, body: { issuer: ISSUER, jwks_uri: `${ISSUER}/jwks` } },
    ]);
    const discovery = newIssuerDiscovery(fetchImpl);

    await expect(discovery.discover(ISSUER)).rejects.toThrow(
      "answered HTTP 503",
    );
    expect((await discovery.discover(ISSUER)).jwksUri).toBe(`${ISSUER}/jwks`);
    expect(fetchImpl.urls).toHaveLength(2);
  });

  it("keeps issuers apart in the cache", async () => {
    const other = "https://other.test";
    const discovery = newIssuerDiscovery(
      fetchAnswering([
        { status: 200, body: { issuer: ISSUER, jwks_uri: "a" } },
        { status: 200, body: { issuer: other, jwks_uri: "b" } },
      ]),
    );
    expect((await discovery.discover(ISSUER)).jwksUri).toBe("a");
    expect((await discovery.discover(other)).jwksUri).toBe("b");
  });
});

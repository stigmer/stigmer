/**
 * Pins the OIDC userinfo client (oidc-userinfo.ts; 20260911.11 A8): the
 * endpoint is the vouching issuer's discovered `userinfo_endpoint`, called
 * with the caller's own token as a bearer; the claims map as the cloud's
 * client maps them (email, given_name, family_name, picture; missing or
 * non-string → ""); a document with no userinfo_endpoint and a non-2xx
 * answer both throw (the domain wraps them UserInfoFetchError). The fetch
 * and the discovery are injected; nothing dials out.
 */
import { describe, expect, it } from "vitest";

import type { IssuerDiscovery } from "../oidc-discovery.js";
import { newOidcUserInfoClient } from "../oidc-userinfo.js";

const ISSUER = "https://issuer.test";

function discoveryNaming(
  userinfoEndpoint: string | undefined,
): IssuerDiscovery {
  return {
    discover: (issuer) =>
      Promise.resolve({ issuer, jwksUri: `${issuer}/jwks`, userinfoEndpoint }),
  };
}

function fetchRecording(
  status: number,
  body: unknown,
): typeof fetch & { requests: Array<{ url: string; authorization: string }> } {
  const requests: Array<{ url: string; authorization: string }> = [];
  const impl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const headers = new Headers(init?.headers);
    requests.push({
      url: String(input),
      authorization: headers.get("authorization") ?? "",
    });
    return new Response(JSON.stringify(body), { status });
  };
  return Object.assign(impl as typeof fetch, { requests });
}

describe("newOidcUserInfoClient", () => {
  it("calls the issuer's discovered userinfo endpoint with the token as a bearer and maps the claims", async () => {
    const fetchImpl = fetchRecording(200, {
      sub: "auth0|alice",
      email: "alice@example.com",
      given_name: "Alice",
      family_name: "Liddell",
      picture: "https://img.example/alice.png",
    });
    const client = newOidcUserInfoClient(
      discoveryNaming(`${ISSUER}/userinfo`),
      fetchImpl,
    );

    const profile = await client.fetchUserProfile(ISSUER, "the-token");

    expect(profile).toEqual({
      email: "alice@example.com",
      firstName: "Alice",
      lastName: "Liddell",
      pictureUrl: "https://img.example/alice.png",
    });
    expect(fetchImpl.requests).toEqual([
      { url: `${ISSUER}/userinfo`, authorization: "Bearer the-token" },
    ]);
  });

  it("a missing or non-string claim is the empty string", async () => {
    const client = newOidcUserInfoClient(
      discoveryNaming(`${ISSUER}/userinfo`),
      fetchRecording(200, { sub: "x", email: 42, given_name: null }),
    );
    expect(await client.fetchUserProfile(ISSUER, "t")).toEqual({
      email: "",
      firstName: "",
      lastName: "",
      pictureUrl: "",
    });
  });

  it("refuses an issuer whose discovery names no userinfo_endpoint — never a guessed URL", async () => {
    const fetchImpl = fetchRecording(200, {});
    const client = newOidcUserInfoClient(discoveryNaming(undefined), fetchImpl);
    await expect(client.fetchUserProfile(ISSUER, "t")).rejects.toThrow(
      "publishes no userinfo_endpoint",
    );
    expect(fetchImpl.requests).toEqual([]);
  });

  it("a non-2xx answer throws with the status", async () => {
    const client = newOidcUserInfoClient(
      discoveryNaming(`${ISSUER}/userinfo`),
      fetchRecording(503, {}),
    );
    await expect(client.fetchUserProfile(ISSUER, "t")).rejects.toThrow(
      "userinfo answered 503",
    );
  });
});

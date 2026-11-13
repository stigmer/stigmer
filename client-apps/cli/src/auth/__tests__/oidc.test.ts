// Unit tests for the identity-provider reading the sign-in shares
// (auth/oidc.ts): a discovery document is the announced issuer's own and names
// only https endpoints (http on this machine); a provider sits on the server's
// own site by its registrable domain, never two names under one public suffix;
// a token response becomes a token set, and a provider's refusal keeps its
// own words.

import { describe, expect, it } from "vitest";
import { CliExitError } from "../../errors/index.js";
import { hostOf, isTrustedEndpoint, providerOnServersSite, readDiscovery, tokenSetOf } from "../oidc.js";

const ISSUER = "https://id.stigmer.ai/";

function document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issuer: ISSUER,
    authorization_endpoint: "https://id.stigmer.ai/authorize",
    token_endpoint: "https://id.stigmer.ai/oauth/token",
    ...overrides,
  };
}

function refusal(run: () => unknown): CliExitError {
  try {
    run();
  } catch (err) {
    if (err instanceof CliExitError) return err;
    throw err;
  }
  throw new Error("expected a refusal");
}

describe("readDiscovery", () => {
  it("reads the endpoints, the device endpoint when offered", () => {
    expect(readDiscovery(ISSUER, document())).toEqual({
      authorizationEndpoint: "https://id.stigmer.ai/authorize",
      tokenEndpoint: "https://id.stigmer.ai/oauth/token",
    });
    expect(
      readDiscovery(ISSUER, document({ device_authorization_endpoint: "https://id.stigmer.ai/oauth/device/code" }))
        .deviceAuthorizationEndpoint,
    ).toBe("https://id.stigmer.ai/oauth/device/code");
  });

  it("refuses a document naming another issuer, even by a trailing slash", () => {
    expect(refusal(() => readDiscovery(ISSUER, document({ issuer: "https://id.stigmer.ai" }))).message).toBe(
      "the sign-in provider says it is https://id.stigmer.ai, but this server named https://id.stigmer.ai/",
    );
  });

  it("refuses an endpoint that is plain http off this machine", () => {
    expect(
      refusal(() => readDiscovery(ISSUER, document({ token_endpoint: "http://id.stigmer.ai/oauth/token" }))).message,
    ).toBe("the sign-in provider names http://id.stigmer.ai/oauth/token, which is not https");
  });

  it("refuses something that is no discovery document", () => {
    expect(refusal(() => readDiscovery(ISSUER, { hello: "world" })).message).toBe(
      "https://id.stigmer.ai/ published no OpenID Connect discovery document the CLI can read",
    );
  });
});

describe("isTrustedEndpoint", () => {
  it.each([
    ["https://id.stigmer.ai/token", true],
    ["http://127.0.0.1:4000/token", true],
    ["http://localhost:4000/token", true],
    ["http://[::1]:4000/token", true],
    ["http://id.stigmer.ai/token", false],
    ["ftp://id.stigmer.ai/token", false],
    ["not a url", false],
  ])("%s -> %s", (url, trusted) => {
    expect(isTrustedEndpoint(url)).toBe(trusted);
  });
});

describe("providerOnServersSite", () => {
  it.each([
    ["api.stigmer.ai:443", "https://id.stigmer.ai/", true],
    ["api.dev.stigmer.ai:443", "https://id.preprod.stigmer.ai/", true],
    ["stigmer.acme.co.uk:443", "https://login.acme.co.uk/", true],
    ["localhost:7234", "http://127.0.0.1:4000", true],
    ["stigmer.internal:7234", "https://stigmer.internal/realms/x", true],
    ["api.evil.test:443", "https://id.stigmer.ai/", false],
    ["stigmer.evil.co.uk:443", "https://login.acme.co.uk/", false],
    // The Public Suffix List's private section: each tenant is its own site.
    ["evil.github.io:443", "https://victim.github.io/", false],
    ["evil.fly.dev:443", "https://victim.fly.dev/", false],
    ["stigmer.victim.fly.dev:443", "https://id.victim.fly.dev/", true],
    ["stigmer.acme.test:443", "http://127.0.0.1:4000", false],
  ])("%s with %s -> %s", (server, issuer, same) => {
    expect(providerOnServersSite(server, issuer)).toBe(same);
  });

  it("reads a host from a gRPC address or a URL", () => {
    expect(hostOf("api.stigmer.ai:443")).toBe("api.stigmer.ai");
    expect(hostOf("https://ID.stigmer.ai/")).toBe("id.stigmer.ai");
    expect(hostOf("[::1]:7234")).toBe("::1");
  });
});

describe("tokenSetOf", () => {
  it("keeps the token, the refresh token and an absolute expiry", () => {
    const before = Date.now();
    const set = tokenSetOf({ access_token: "a", refresh_token: "r", expires_in: 60 });
    expect(set.accessToken).toBe("a");
    expect(set.refreshToken).toBe("r");
    expect(Date.parse(set.expiresAt ?? "")).toBeGreaterThanOrEqual(before + 60_000);
  });

  it("refuses an answer with no access token", () => {
    expect(refusal(() => tokenSetOf({ token_type: "Bearer" })).message).toBe(
      "authentication failed: the provider answered no access token",
    );
  });
});

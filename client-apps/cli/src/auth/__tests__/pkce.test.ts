// Unit tests for the PKCE helpers (auth/pkce.ts) and the authorize address
// the browser sign-in opens (auth/oidc.ts authorizeUrl): the S256 challenge,
// the state, the announced client and audience, the loopback redirect.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authorizeUrl } from "../oidc.js";
import { challengeS256, generateState, generateVerifier } from "../pkce.js";

describe("PKCE helpers", () => {
  it("generates a base64url verifier with no padding", () => {
    const verifier = generateVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier).not.toContain("=");
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });

  it("derives the S256 challenge as base64url(sha256(verifier))", () => {
    const verifier = "fixed-verifier-value";
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challengeS256(verifier)).toBe(expected);
    expect(challengeS256(verifier)).not.toContain("=");
  });

  it("produces distinct random verifiers and states", () => {
    expect(generateVerifier()).not.toBe(generateVerifier());
    expect(generateState()).not.toBe(generateState());
  });
});

describe("authorize URL", () => {
  it("includes the PKCE challenge, S256 method, state, and prompt=login", () => {
    const url = new URL(
      authorizeUrl({
        discovery: { authorizationEndpoint: "https://id.example.test/authorize", tokenEndpoint: "https://id.example.test/oauth/token" },
        signIn: { issuer: "https://id.example.test/", audience: "https://api.example.test/", clientId: "native" },
        redirectUri: "http://127.0.0.1:17234/auth/callback",
        state: "st",
        codeChallenge: "ch",
      }),
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge")).toBe("ch");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("prompt")).toBe("login");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:17234/auth/callback");
    expect(url.searchParams.get("client_id")).toBe("native");
    expect(url.searchParams.get("audience")).toBe("https://api.example.test/");
    expect(url.searchParams.get("scope")).toBe("openid profile email offline_access");
  });
});

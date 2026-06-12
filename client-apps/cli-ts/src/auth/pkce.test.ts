import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl } from "./auth0.js";
import { challengeS256, generateState, generateVerifier } from "./pkce.js";

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
    const url = new URL(buildAuthorizeUrl({ state: "st", codeChallenge: "ch" }));
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge")).toBe("ch");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("prompt")).toBe("login");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:8088/auth/callback");
  });
});

/**
 * Pins PKCE pair generation against Go oauth/pkce.go: 32-byte base64url
 * verifier (no padding), S256 challenge = base64url(SHA-256(verifier)) —
 * RFC 7636 / OAuth 2.1 shape the mock authorization server verifies at
 * the token exchange.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { generatePkce } from "../pkce.js";

describe("generatePkce", () => {
  it("produces a 43-char base64url verifier (32 bytes, no padding)", () => {
    const pair = generatePkce();
    expect(pair.codeVerifier).toHaveLength(43);
    expect(pair.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("derives the challenge as base64url(SHA-256(verifier)) — S256", () => {
    const pair = generatePkce();
    const expected = createHash("sha256")
      .update(pair.codeVerifier)
      .digest()
      .toString("base64url");
    expect(pair.codeChallenge).toBe(expected);
  });

  it("generates a fresh pair on every call", () => {
    const a = generatePkce();
    const b = generatePkce();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.codeChallenge).not.toBe(b.codeChallenge);
  });
});

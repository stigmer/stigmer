import { describe, it, expect } from "vitest";
import { tokenTypeOf, isEmbeddedRunnerToken, sessionIdClaimOf, isJwtShaped, expiryClaimOf } from "../token-claims.js";

/** Build an unsigned JWT-shaped token with the given payload. */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(payload)}.signature`;
}

describe("tokenTypeOf", () => {
  it("extracts the token_type claim", () => {
    expect(tokenTypeOf(fakeJwt({ token_type: "embedded_runner" }))).toBe("embedded_runner");
    expect(tokenTypeOf(fakeJwt({ token_type: "sandbox" }))).toBe("sandbox");
  });

  it("returns undefined for tokens without the claim (e.g. a user's Auth0 token)", () => {
    expect(tokenTypeOf(fakeJwt({ sub: "user-1" }))).toBeUndefined();
  });

  it("returns undefined for a non-string claim value", () => {
    expect(tokenTypeOf(fakeJwt({ token_type: 42 }))).toBeUndefined();
  });

  it("returns undefined for null, empty, and malformed tokens", () => {
    expect(tokenTypeOf(null)).toBeUndefined();
    expect(tokenTypeOf(undefined)).toBeUndefined();
    expect(tokenTypeOf("")).toBeUndefined();
    expect(tokenTypeOf("not-a-jwt")).toBeUndefined();
    expect(tokenTypeOf("only.two")).toBeUndefined();
    expect(tokenTypeOf("a.%%%not-base64%%%.c")).toBeUndefined();
  });
});

describe("sessionIdClaimOf", () => {
  it("extracts the session_id claim of a session sandbox token", () => {
    expect(sessionIdClaimOf(fakeJwt({ token_type: "sandbox", session_id: "ses_1" })))
      .toBe("ses_1");
  });

  it("returns undefined when the claim is absent or non-string", () => {
    expect(sessionIdClaimOf(fakeJwt({ token_type: "pool_sandbox" }))).toBeUndefined();
    expect(sessionIdClaimOf(fakeJwt({ session_id: 7 }))).toBeUndefined();
    expect(sessionIdClaimOf(null)).toBeUndefined();
    expect(sessionIdClaimOf("garbage")).toBeUndefined();
  });
});

describe("isEmbeddedRunnerToken", () => {
  it("is true only for token_type=embedded_runner", () => {
    expect(isEmbeddedRunnerToken(fakeJwt({ token_type: "embedded_runner" }))).toBe(true);
    // A cloud sandbox runner's credential is already scoped — must not gate in.
    expect(isEmbeddedRunnerToken(fakeJwt({ token_type: "sandbox" }))).toBe(false);
    expect(isEmbeddedRunnerToken(fakeJwt({ token_type: "workflow_sandbox" }))).toBe(false);
    // A user token has no token_type claim at all.
    expect(isEmbeddedRunnerToken(fakeJwt({ sub: "user-1" }))).toBe(false);
    expect(isEmbeddedRunnerToken(null)).toBe(false);
  });
});

/** A three-part token whose payload is the given raw text. */
function rawJwt(payloadText: string): string {
  const b64 = (text: string) => Buffer.from(text).toString("base64url");
  return `${b64('{"alg":"none"}')}.${b64(payloadText)}.signature`;
}

describe("isJwtShaped", () => {
  it("accepts three parts with a JSON object payload", () => {
    expect(isJwtShaped(fakeJwt({ sub: "user-1" }))).toBe(true);
    expect(isJwtShaped(rawJwt("{}"))).toBe(true);
  });

  it("refuses absent, malformed, and non-object payloads", () => {
    for (const token of [null, undefined, "", "not-a-jwt", "only.two", "a.b.c", rawJwt("null"), rawJwt("[1,2]"), rawJwt('"text"'), rawJwt("42")]) {
      expect(isJwtShaped(token)).toBe(false);
    }
  });
});

describe("expiryClaimOf", () => {
  it("reads a numeric exp", () => {
    expect(expiryClaimOf(fakeJwt({ exp: 1_800_000_000 }))).toBe(1_800_000_000);
  });

  it("returns undefined for a missing, non-numeric or non-finite exp, and for malformed tokens", () => {
    expect(expiryClaimOf(fakeJwt({ sub: "u" }))).toBeUndefined();
    expect(expiryClaimOf(fakeJwt({ exp: "1800000000" }))).toBeUndefined();
    expect(expiryClaimOf(rawJwt('{"exp":1e999}'))).toBeUndefined();
    expect(expiryClaimOf("not-a-jwt")).toBeUndefined();
    expect(expiryClaimOf(rawJwt("[]"))).toBeUndefined();
  });
});

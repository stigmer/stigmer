import { describe, it, expect } from "vitest";
import { tokenTypeOf, isEmbeddedRunnerToken } from "../token-claims.js";

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

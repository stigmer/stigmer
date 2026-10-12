/**
 * Pins the shared JWT mechanics every verifier lane builds on, on their
 * own rather than through a lane's policy: the structural decode answers
 * undefined, never throws, for anything that is not a three-part JWT with
 * JSON header and payload (the claim-or-pass "not ours at all" arm); RS256
 * verifies against the signing key and no other, and over the exact signed
 * part; and the audience match accepts both JWT audience forms, a string
 * or an array naming the expected value, and nothing else.
 *
 * The decode accepts one spelling of a token: a part carrying any
 * character outside the unpadded base64url alphabet is not a JWT, though
 * Node's decoder would skip it and yield the same bytes. The signature
 * covers the token as presented, so a respelling was never a forgery, but
 * one signed token must not have many accepted spellings. A conforming
 * token, `-` and `_` included, still decodes.
 */
import { createSign, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { audienceMatches, decodeJwt, verifiesRs256 } from "../jwt.js";

const SIGNER = generateKeyPairSync("rsa", { modulusLength: 2048 });
const STRANGER = generateKeyPairSync("rsa", { modulusLength: 2048 });

function segment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signed(payload: Record<string, unknown>): string {
  const signedPart = `${segment({ alg: "RS256", kid: "k1" })}.${segment(payload)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signedPart);
  return `${signedPart}.${signer.sign(SIGNER.privateKey).toString("base64url")}`;
}

describe("decodeJwt", () => {
  it("decodes a three-part JWT into its header, payload, signed part and signature", () => {
    const token = signed({ iss: "https://idp.test", sub: "user-1" });
    const decoded = decodeJwt(token);
    expect(decoded?.header).toEqual({ alg: "RS256", kid: "k1" });
    expect(decoded?.payload).toEqual({ iss: "https://idp.test", sub: "user-1" });
    expect(decoded?.signedPart).toBe(token.slice(0, token.lastIndexOf(".")));
    expect(decoded?.signature.length).toBe(256);
  });

  it("answers undefined, never throws, for anything that is not a JWT", () => {
    const header = segment({ alg: "RS256" });
    const payload = segment({ sub: "user-1" });
    for (const token of [
      "",
      "plain-token",
      `${header}.${payload}`,
      `${header}.${payload}.sig.extra`,
      `${header}.${Buffer.from("not json").toString("base64url")}.sig`,
      `${segment("a string")}.${payload}.sig`,
      `${header}.${segment(null)}.sig`,
    ]) {
      expect(decodeJwt(token), token).toBeUndefined();
    }
  });
});

describe("decodeJwt's alphabet", () => {
  it("answers undefined for a signed token with any character outside base64url in any part", () => {
    const [header, payload, signature] = signed({ iss: "https://idp.test", sub: "user-1" }).split(".") as [string, string, string];
    const spliced = (part: string, extra: string): string => `${part.slice(0, 4)}${extra}${part.slice(4)}`;
    for (const token of [
      `${spliced(header, "!")}.${payload}.${signature}`,
      `${header}.${spliced(payload, " ")}.${signature}`,
      `${header}.${payload}.${spliced(signature, "*")}`,
      `${header}.${payload}.${signature}=`,
      `${header}.${payload}.${spliced(signature, "+")}`,
    ]) {
      expect(decodeJwt(token), token).toBeUndefined();
    }
  });

  it("decodes a conforming token whose parts use '-' and '_'", () => {
    let payload = "";
    for (let pad = 0; !(payload.includes("-") && payload.includes("_")); pad += 1) {
      payload = segment({ sub: `user-1${"?".repeat(pad % 7)}${">".repeat(pad % 5)}` });
    }
    const token = `${segment({ alg: "RS256" })}.${payload}.abc-_def`;
    expect(decodeJwt(token)?.signature).toEqual(Buffer.from("abc-_def", "base64url"));
  });
});

describe("verifiesRs256", () => {
  it("verifies a token against the key that signed it", () => {
    const decoded = decodeJwt(signed({ sub: "user-1" }));
    expect(decoded).toBeDefined();
    expect(decoded !== undefined && verifiesRs256(decoded, SIGNER.publicKey)).toBe(true);
  });

  it("refuses another key, and a payload changed after signing", () => {
    const token = signed({ sub: "user-1" });
    const decoded = decodeJwt(token);
    expect(decoded !== undefined && verifiesRs256(decoded, STRANGER.publicKey)).toBe(false);

    const [header, , signature] = token.split(".");
    const tampered = decodeJwt(`${header}.${segment({ sub: "admin" })}.${signature}`);
    expect(tampered !== undefined && verifiesRs256(tampered, SIGNER.publicKey)).toBe(false);
  });
});

describe("audienceMatches", () => {
  it("accepts the string form naming the expected audience, and the array form containing it", () => {
    expect(audienceMatches("https://api.test", "https://api.test")).toBe(true);
    expect(audienceMatches(["https://api.test", "https://idp.test/userinfo"], "https://api.test")).toBe(true);
  });

  it("refuses any other audience, and any other shape", () => {
    expect(audienceMatches("https://other.test", "https://api.test")).toBe(false);
    expect(audienceMatches(["https://other.test"], "https://api.test")).toBe(false);
    expect(audienceMatches([], "https://api.test")).toBe(false);
    expect(audienceMatches(undefined, "https://api.test")).toBe(false);
    expect(audienceMatches(42, "https://api.test")).toBe(false);
    expect(audienceMatches({ aud: "https://api.test" }, "https://api.test")).toBe(false);
  });
});

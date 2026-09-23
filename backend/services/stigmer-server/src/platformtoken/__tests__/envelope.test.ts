/**
 * Pins the platform-token envelope against the cloud verifier's semantics,
 * which every token in the field was accepted under:
 *   - a signed token round-trips with the envelope's claims and the lane's;
 *   - a token signed by the previous key still verifies (the rotation
 *     window), and the header's kid never selects a key;
 *   - the forgeries a JWT verifier must refuse are refused as a bad
 *     signature: `alg: none`, and an HMAC token keyed with the public key;
 *   - expiry is strict (no leeway), a missing `aud` is tolerated, a wrong
 *     one refused, and a missing `sub` refused — each with its pinned copy;
 *   - anything that is not a three-part `iss: "stigmer"` JWT is foreign,
 *     never refused, so the next verifier judges it;
 *   - a lane cannot set a claim the envelope owns.
 */
import { createHmac, generateKeyPairSync } from "node:crypto";

import { Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import {
  PLATFORM_TOKEN_REFUSAL_MESSAGES,
  decodeVerifiedPlatformTokenPayload,
  platformTokenRefusalError,
  signPlatformToken,
  verifyPlatformToken,
} from "../envelope.js";
import { platformTokenKeyRingFromPem } from "../key-ring.js";
import type { SigningPlatformTokenKeyRing } from "../key-ring.js";

function pemPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

const active = pemPair();
const previous = pemPair();

function signingRing(options: {
  pair?: { privateKeyPem: string; publicKeyPem: string };
  audience?: string;
  ttlSeconds?: number;
} = {}): SigningPlatformTokenKeyRing {
  const pair = options.pair ?? active;
  const ring = platformTokenKeyRingFromPem({
    privateKeyPem: pair.privateKeyPem,
    kid: "stigmer-signing-key-1",
    publicKeyPems: [pair.publicKeyPem],
    audience: options.audience ?? "",
    ttlSeconds: options.ttlSeconds ?? 900,
  });
  if (ring.signer === undefined) throw new Error("fixture ring must sign");
  return { ...ring, signer: ring.signer };
}

const NOW = new Date("2026-09-23T10:00:00Z");

function base64UrlJson(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe("the platform-token envelope", () => {
  it("round-trips a signed token: the envelope's claims, then the lane's", () => {
    const ring = signingRing({ audience: "https://api.stigmer.ai" });
    const token = signPlatformToken(ring, { sub: "ida_1", platform_client_id: "pcl_1" }, NOW);

    const result = verifyPlatformToken(ring, token, NOW);
    expect(result.outcome).toBe("verified");
    if (result.outcome !== "verified") return;
    expect(result.token.subject).toBe("ida_1");
    expect(result.token.tokenType).toBeUndefined();
    expect(result.token.payload).toMatchObject({
      iss: "stigmer",
      iat: NOW.getTime() / 1000,
      exp: NOW.getTime() / 1000 + 900,
      aud: "https://api.stigmer.ai",
      platform_client_id: "pcl_1",
    });
    const header = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString());
    expect(header).toEqual({ alg: "RS256", typ: "JWT", kid: "stigmer-signing-key-1" });
  });

  it("reads token_type as the lane discriminator", () => {
    const ring = signingRing();
    const token = signPlatformToken(ring, { sub: "ida_guest", token_type: "guest" }, NOW);
    const result = verifyPlatformToken(ring, token, NOW);
    expect(result.outcome === "verified" && result.token.tokenType).toBe("guest");
  });

  it("verifies a token signed by the previous key while it is still accepted, whatever the kid says", () => {
    const old = signPlatformToken(signingRing({ pair: previous }), { sub: "ida_1" }, NOW);
    const ring = platformTokenKeyRingFromPem({
      privateKeyPem: active.privateKeyPem,
      kid: "stigmer-signing-key-1",
      publicKeyPems: [active.publicKeyPem, previous.publicKeyPem],
    });
    expect(verifyPlatformToken(ring, old, NOW).outcome).toBe("verified");
  });

  it("refuses `alg: none` and an HMAC token keyed with the public key as a bad signature", () => {
    const ring = signingRing();
    const payload = base64UrlJson({ iss: "stigmer", sub: "ida_1", exp: NOW.getTime() / 1000 + 60 });

    const unsigned = `${base64UrlJson({ alg: "none", typ: "JWT" })}.${payload}.`;
    expect(verifyPlatformToken(ring, unsigned, NOW)).toEqual({
      outcome: "refused",
      refusal: "signature",
    });

    const hmacHeader = base64UrlJson({ alg: "HS256", typ: "JWT" });
    const forged = createHmac("sha256", active.publicKeyPem)
      .update(`${hmacHeader}.${payload}`)
      .digest("base64url");
    expect(verifyPlatformToken(ring, `${hmacHeader}.${payload}.${forged}`, NOW)).toEqual({
      outcome: "refused",
      refusal: "signature",
    });
  });

  it("refuses a token signed by a key the ring does not hold", () => {
    const stranger = signPlatformToken(signingRing({ pair: pemPair() }), { sub: "ida_1" }, NOW);
    expect(verifyPlatformToken(signingRing(), stranger, NOW)).toEqual({
      outcome: "refused",
      refusal: "signature",
    });
  });

  it("refuses an expired token strictly, with no leeway", () => {
    const ring = signingRing({ ttlSeconds: 60 });
    const token = signPlatformToken(ring, { sub: "ida_1" }, NOW);
    const atExpiry = new Date(NOW.getTime() + 60_000);
    expect(verifyPlatformToken(ring, token, atExpiry)).toEqual({
      outcome: "refused",
      refusal: "expired",
    });
  });

  it("tolerates a missing aud and refuses one that names another audience", () => {
    const noAudience = signPlatformToken(signingRing(), { sub: "ida_1" }, NOW);
    const expecting = signingRing({ audience: "https://api.stigmer.ai" });
    expect(verifyPlatformToken(expecting, noAudience, NOW).outcome).toBe("verified");

    const elsewhere = signPlatformToken(
      signingRing({ audience: "https://staging.stigmer.ai" }),
      { sub: "ida_1" },
      NOW,
    );
    expect(verifyPlatformToken(expecting, elsewhere, NOW)).toEqual({
      outcome: "refused",
      refusal: "audience",
    });
  });

  it("refuses a token with no subject", () => {
    const ring = signingRing();
    const token = signPlatformToken(ring, { platform_client_id: "pcl_1" }, NOW);
    expect(verifyPlatformToken(ring, token, NOW)).toEqual({
      outcome: "refused",
      refusal: "subject",
    });
  });

  it("answers foreign for anything that is not a stigmer-issued three-part JWT", () => {
    const ring = signingRing();
    expect(verifyPlatformToken(ring, "stk_an_api_key", NOW).outcome).toBe("foreign");
    expect(verifyPlatformToken(ring, "a.b", NOW).outcome).toBe("foreign");
    const otherIssuer = `${base64UrlJson({ alg: "RS256" })}.${base64UrlJson({ iss: "https://issuer.example", sub: "x" })}.sig`;
    expect(verifyPlatformToken(ring, otherIssuer, NOW).outcome).toBe("foreign");
    expect(decodeVerifiedPlatformTokenPayload(otherIssuer)).toBeUndefined();
    expect(decodeVerifiedPlatformTokenPayload("")).toBeUndefined();
  });

  it("refuses a lane claim that collides with an envelope claim", () => {
    expect(() => signPlatformToken(signingRing(), { sub: "ida_1", exp: 1 }, NOW)).toThrow(
      /belongs to the envelope/,
    );
  });

  it("maps every refusal to UNAUTHENTICATED with the cloud verifier's copy", () => {
    expect(PLATFORM_TOKEN_REFUSAL_MESSAGES).toEqual({
      signature: "platform token signature verification failed",
      expired: "platform token is expired",
      audience: "platform token was minted for another environment",
      subject: "platform token carries no subject",
    });
    const error = platformTokenRefusalError("expired");
    expect(error.code).toBe(Code.Unauthenticated);
    expect(error.rawMessage).toBe("platform token is expired");
  });
});

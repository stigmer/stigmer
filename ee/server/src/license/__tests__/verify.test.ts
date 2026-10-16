/**
 * Pins the license verifier (license/verify.ts):
 *
 *   - the issuer's golden vector verifies under its public key and yields
 *     its claims; under a ring without that key it is `unknown-key`;
 *   - a fresh key signed in the issuer's format verifies;
 *   - every loosening a JOSE library would allow is refused as malformed:
 *     padding, a foreign alphabet, a non-canonical segment, a missing or
 *     extra segment, a header with `crit` or any other member, another
 *     algorithm or type, an empty or non-string kid;
 *   - the ring is consulted before the signature: an untrusted kid is
 *     `unknown-key` even with a garbage signature;
 *   - a 63- or 65-byte signature, a signature by another key and a payload
 *     changed after signing are `bad-signature`;
 *   - a signed payload with an unknown member, a broken contract rule or
 *     JSON that does not parse is `bad-claims`;
 *   - no refusal sentence contains the key or any segment of it.
 */
import { sign } from "node:crypto";

import { create, toJson, type JsonObject } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import { LicenseClaimsSchema } from "@stigmer/apis/ai/stigmer/platform/v1/license_pb";

import { verifyLicenseTicket, type LicenseRefusalKind } from "../verify.js";
import { goldenVector, newTestSigner, segment, writeTicket } from "./test-tickets.js";

const golden = goldenVector();
const signer = newTestSigner();

function refusalOf(ticket: string, ring = signer.ring): LicenseRefusalKind | undefined {
  const result = verifyLicenseTicket(ticket, ring);
  if (result.ok) {
    return undefined;
  }
  for (const part of ticket.split(".").filter((p) => p.length > 8)) {
    expect(result.refusal.message).not.toContain(part);
  }
  return result.refusal.kind;
}

describe("verifyLicenseTicket: keys that verify", () => {
  it("verifies the issuer's golden vector under its public key and yields its claims", () => {
    const result = verifyLicenseTicket(golden.ticket, new Map([[golden.keyId, golden.publicKey]]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.keyId).toBe("license-signing-golden:v1");
      expect(toJson(LicenseClaimsSchema, result.claims)).toEqual(
        toJson(LicenseClaimsSchema, golden.claims),
      );
      expect(result.claims.entitlements?.limits?.maxOrgs).toBe(5);
    }
  });

  it("refuses the golden vector as unknown-key under a ring without its key", () => {
    expect(refusalOf(golden.ticket, new Map())).toBe("unknown-key");
    expect(refusalOf(golden.ticket)).toBe("unknown-key");
  });

  it("verifies a fresh key written in the issuer's format", () => {
    const result = verifyLicenseTicket(writeTicket(signer, golden.claims), signer.ring);
    expect(result.ok && result.keyId).toBe(signer.keyId);
  });

  it("throws, as the build defect it is, when the ring holds a key that is not 32 bytes", () => {
    const broken = new Map([[signer.keyId, new Uint8Array(31)]]);
    expect(() => verifyLicenseTicket(writeTicket(signer, golden.claims), broken)).toThrow(
      `the trusted license key '${signer.keyId}' is 31 bytes; an Ed25519 public key is 32`,
    );
  });
});

describe("verifyLicenseTicket: malformed", () => {
  const good = writeTicket(signer, golden.claims);
  const [h, p, s] = good.split(".") as [string, string, string];

  it.each([
    ["padding on a segment", `${h}=.${p}.${s}`],
    ["the standard base64 alphabet", `${h}.${p}.${s.replace(/_/g, "/").replace(/-/g, "+")}+/`],
    ["two segments", `${h}.${p}`],
    ["four segments", `${good}.${s}`],
    ["an empty segment", `${h}..${s}`],
    ["whitespace", ` ${good}`],
  ])("refuses %s", (_name, ticket) => {
    expect(refusalOf(ticket)).toBe("malformed");
  });

  it("refuses a segment that decodes to the same bytes but is not in canonical form", () => {
    // 64 signature bytes take 86 characters, whose last carries 4 unused
    // low bits: flipping the lowest decodes to the same bytes, which no
    // issuer writes.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = alphabet.indexOf(s.charAt(s.length - 1));
    const altered = `${s.slice(0, -1)}${alphabet.charAt(last ^ 1)}`;
    expect(Buffer.from(altered, "base64url").equals(Buffer.from(s, "base64url"))).toBe(true);
    expect(refusalOf(`${h}.${p}.${altered}`)).toBe("malformed");
  });

  it.each([
    ["a crit member", { alg: "EdDSA", typ: "JWT", kid: signer.keyId, crit: ["exp"] }],
    ["any extra member", { alg: "EdDSA", typ: "JWT", kid: signer.keyId, jku: "https://evil.example" }],
    ["another algorithm", { alg: "none", typ: "JWT", kid: signer.keyId }],
    ["an RSA algorithm", { alg: "RS256", typ: "JWT", kid: signer.keyId }],
    ["another type", { alg: "EdDSA", typ: "JOSE", kid: signer.keyId }],
    ["no kid", { alg: "EdDSA", typ: "JWT" }],
    ["an empty kid", { alg: "EdDSA", typ: "JWT", kid: "" }],
    ["a numeric kid", { alg: "EdDSA", typ: "JWT", kid: 1 }],
  ])("refuses a header with %s", (_name, header) => {
    expect(refusalOf(writeTicket(signer, golden.claims, { header }))).toBe("malformed");
  });

  it("refuses a header that is not a JSON object", () => {
    const ticket = `${segment("[1,2]")}.${p}.${s}`;
    expect(refusalOf(ticket)).toBe("malformed");
    expect(refusalOf(`${segment("not json")}.${p}.${s}`)).toBe("malformed");
  });
});

describe("verifyLicenseTicket: the ring before the signature", () => {
  it("refuses an untrusted kid as unknown-key, even with a garbage signature", () => {
    const ticket = writeTicket(signer, golden.claims, {
      header: { alg: "EdDSA", typ: "JWT", kid: "license-signing:v99" },
      signature: new Uint8Array(3),
    });
    expect(refusalOf(ticket)).toBe("unknown-key");
  });
});

describe("verifyLicenseTicket: bad-signature", () => {
  it.each([63, 65])("refuses a %i-byte signature", (length) => {
    expect(
      refusalOf(writeTicket(signer, golden.claims, { signature: new Uint8Array(length) })),
    ).toBe("bad-signature");
  });

  it("refuses a signature by another key under the same kid", () => {
    const impostor = newTestSigner(signer.keyId);
    expect(refusalOf(writeTicket(impostor, golden.claims))).toBe("bad-signature");
  });

  it("refuses a payload changed after signing", () => {
    const [h, , s] = writeTicket(signer, golden.claims).split(".") as [string, string, string];
    const richer = toJson(LicenseClaimsSchema, golden.claims) as JsonObject;
    richer["entitlements"] = { limits: { maxOrgs: 500, maxUsers: 250 } };
    expect(refusalOf(`${h}.${segment(JSON.stringify(richer))}.${s}`)).toBe("bad-signature");
  });
});

describe("verifyLicenseTicket: bad-claims", () => {
  it("refuses a signed payload carrying a member the contract does not define", () => {
    const payload: JsonObject = {
      ...(toJson(LicenseClaimsSchema, golden.claims) as JsonObject),
      unlimited: true,
    };
    expect(refusalOf(writeTicket(signer, golden.claims, { payload }))).toBe("bad-claims");
  });

  it("refuses signed claims that break a contract rule (expires before issued)", () => {
    const broken = create(LicenseClaimsSchema, {
      ...golden.claims,
      expiresAt: timestampFromDate(new Date("2026-01-01T00:00:00Z")),
      graceUntil: timestampFromDate(new Date("2026-02-01T00:00:00Z")),
    });
    expect(refusalOf(writeTicket(signer, broken))).toBe("bad-claims");
  });

  it("refuses signed claims missing a required field", () => {
    const payload: JsonObject = { ...(toJson(LicenseClaimsSchema, golden.claims) as JsonObject) };
    delete payload["licenseId"];
    expect(refusalOf(writeTicket(signer, golden.claims, { payload }))).toBe("bad-claims");
  });

  it("refuses a signed payload that is not JSON", () => {
    // Signed over the non-JSON payload, so only the claims step can refuse it.
    const header = segment(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: signer.keyId }));
    const payload = segment("{not json");
    const signature = sign(null, Buffer.from(`${header}.${payload}`, "ascii"), signer.privateKey);
    expect(refusalOf(`${header}.${payload}.${segment(signature)}`)).toBe("bad-claims");
  });
});

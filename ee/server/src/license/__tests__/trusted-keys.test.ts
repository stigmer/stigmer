/**
 * Pins the compiled key ring (license/trusted-keys.ts):
 *
 *   - every read is a fresh ring: a key added to one copy, or a byte
 *     changed in one copy's key, never reaches the next read. Proved on a
 *     ring of a test key, because the compiled ring is empty until the
 *     production issuer's key is compiled in;
 *   - every compiled key decodes, and the decoding refuses a key that is
 *     not canonical base64 of 32 bytes, and a kid listed twice, so a
 *     mangled or repeated paste fails here rather than at a customer's
 *     boot;
 *   - the issuer's golden vector is never trusted: neither its kid nor its
 *     public key under any kid.
 */
import { describe, expect, it } from "vitest";

import { licenseKeyRing, trustedLicenseKeys, type CompiledLicenseKey } from "../trusted-keys.js";
import { goldenVector, newTestSigner } from "./test-tickets.js";

const signer = newTestSigner();
const entries: ReadonlyArray<CompiledLicenseKey> = [
  [signer.keyId, Buffer.from(signer.publicKey).toString("base64")],
];

describe("licenseKeyRing", () => {
  it("builds a fresh ring on every call, so a write to one copy never reaches the next", () => {
    const first = licenseKeyRing(entries) as Map<string, Uint8Array>;
    first.set("license-signing:forged", new Uint8Array(32));
    const bytes = first.get(signer.keyId);
    expect(bytes).toBeDefined();
    bytes?.fill(0);

    const second = licenseKeyRing(entries);
    expect([...second.keys()]).toEqual([signer.keyId]);
    expect(second.get(signer.keyId)).toEqual(signer.publicKey);
  });

  it.each([
    ["a character base64 does not know", (b64: string): string => `${b64.slice(0, 10)}*${b64.slice(10)}`],
    ["a key one byte short", (): string => Buffer.alloc(31, 7).toString("base64")],
    ["a key one byte long", (): string => Buffer.alloc(33, 7).toString("base64")],
    ["base64url instead of base64", (): string => Buffer.alloc(32, 0xfb).toString("base64url")],
  ])("refuses %s, naming the kid", (_name, mangle) => {
    const [kid, b64] = entries[0] ?? ["", ""];
    expect(() => licenseKeyRing([[kid, mangle(b64)]])).toThrow(`'${kid}'`);
  });

  it("refuses a kid listed twice rather than letting the second entry replace the first", () => {
    const other = Buffer.from(newTestSigner().publicKey).toString("base64");
    const [kid, b64] = entries[0] ?? ["", ""];
    expect(() => licenseKeyRing([[kid, b64], [kid, other]])).toThrow(`'${kid}' is listed twice`);
  });
});

describe("trustedLicenseKeys", () => {
  it("decodes every compiled key to 32 bytes and hands each caller its own ring", () => {
    const ring = trustedLicenseKeys();
    for (const [kid, raw] of ring) {
      expect(raw.length, kid).toBe(32);
    }
    (ring as Map<string, Uint8Array>).set("license-signing:forged", new Uint8Array(32));
    expect(trustedLicenseKeys().has("license-signing:forged")).toBe(false);
  });

  it("never trusts the golden vector, by its kid or by its public key under any kid", () => {
    const golden = goldenVector();
    const ring = trustedLicenseKeys();
    expect(ring.has(golden.keyId)).toBe(false);
    for (const raw of ring.values()) {
      expect(Buffer.from(raw).equals(Buffer.from(golden.publicKey))).toBe(false);
    }
  });
});

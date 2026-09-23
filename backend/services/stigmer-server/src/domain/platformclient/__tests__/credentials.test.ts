/**
 * Pins the PlatformClient credential material byte for byte with what
 * Stigmer Cloud has issued (the secrets integrators hold must keep
 * matching): the prefixes and lengths, the base64url SHA-256 over the whole
 * prefixed secret, the last-six fingerprint, and a constant-time match that
 * refuses a wrong secret and an empty stored hash.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  generateClientId,
  generateClientSecret,
  hashClientSecret,
  secretFingerprint,
  secretMatchesHash,
} from "../credentials.js";

describe("PlatformClient credentials", () => {
  it("issues a stgm_cid_ id and a stgm_cs_ secret of the cloud's lengths", () => {
    expect(generateClientId()).toMatch(/^stgm_cid_[A-Za-z0-9_-]{43}$/);
    expect(generateClientSecret()).toMatch(/^stgm_cs_[A-Za-z0-9_-]{64}$/);
  });

  it("hashes the whole prefixed secret with SHA-256, base64url", () => {
    const secret = "stgm_cs_example";
    expect(hashClientSecret(secret)).toBe(
      createHash("sha256").update(secret, "utf8").digest("base64url"),
    );
    expect(hashClientSecret(secret)).toHaveLength(43);
  });

  it("fingerprints the last six characters, or the whole secret when shorter", () => {
    expect(secretFingerprint("stgm_cs_abcdefgh")).toBe("cdefgh");
    expect(secretFingerprint("tiny")).toBe("tiny");
  });

  it("matches only the secret that produced the hash, and never an empty stored hash", () => {
    const secret = generateClientSecret();
    const hash = hashClientSecret(secret);
    expect(secretMatchesHash(secret, hash)).toBe(true);
    expect(secretMatchesHash(generateClientSecret(), hash)).toBe(false);
    expect(secretMatchesHash(secret, "")).toBe(false);
  });
});

/**
 * Pins the SecretService's cross-edition contract: the enc:v1: format
 * (proven against its frozen golden vectors), the keyless
 * pass-through/fail-loud asymmetry, encrypt idempotence (the marker
 * round-trip's foundation), the error taxonomy (invalid ciphertext vs
 * decryption failed vs disabled — the two-armed family of errors.ts),
 * and the fail-closed handling of future-version prefixes, with
 * adversarial arms. An unregistered version refuses as
 * EncryptionUnavailableError (the machinery is missing, the value may be
 * fine), still fail-closed. The seam itself (registry dispatch,
 * write-version resolution, batch verbs, reencrypt, scope) is pinned by
 * codec-seam.test.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DecryptionFailedError,
  ENCRYPTED_PREFIX,
  EncryptionDisabledError,
  EncryptionScope,
  EncryptionUnavailableError,
  GCM_NONCE_SIZE,
  GCM_TAG_SIZE,
  InvalidCiphertextError,
  SecretService,
  isCiphertextShaped,
} from "../encryption.js";

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 8);
const SCOPE = EncryptionScope.forOrganization("test-org");

function enabled(): SecretService {
  return SecretService.create(KEY);
}

function disabled(): SecretService {
  return SecretService.create(undefined);
}

describe("SecretService round-trip", () => {
  it("encrypts and decrypts back to the plaintext", async () => {
    const svc = enabled();
    const plaintexts = [
      "hello world",
      "",
      "x",
      "秘密のパスワード🔐 — ключ",
      "line one\nline two\r\n\ttabbed",
      "a".repeat(10_000),
    ];
    for (const pt of plaintexts) {
      const ct = await svc.encrypt(pt, SCOPE);
      expect(ct.startsWith(ENCRYPTED_PREFIX)).toBe(true);
      expect(await svc.decrypt(ct)).toBe(pt);
    }
  });

  it("produces a unique nonce per encryption (same plaintext, different ciphertext)", async () => {
    const svc = enabled();
    expect(await svc.encrypt("same input", SCOPE)).not.toBe(
      await svc.encrypt("same input", SCOPE),
    );
  });

  it("emits the exact sealed layout: base64(nonce || ct || tag)", async () => {
    const svc = enabled();
    const ct = await svc.encrypt("abc", SCOPE);
    const sealed = Buffer.from(ct.slice(ENCRYPTED_PREFIX.length), "base64");
    expect(sealed.length).toBe(GCM_NONCE_SIZE + 3 + GCM_TAG_SIZE);
  });

  it("is idempotent on already-prefixed input (the marker-restore round-trip)", async () => {
    const svc = enabled();
    const ct = await svc.encrypt("stored secret", SCOPE);
    expect(await svc.encrypt(ct, SCOPE)).toBe(ct);
  });
});

describe("SecretService disabled (keyless) semantics", () => {
  it("reports disabled and passes plaintext through encrypt unchanged", async () => {
    const svc = disabled();
    expect(svc.isEnabled()).toBe(false);
    expect(await svc.encrypt("plain", SCOPE)).toBe("plain");
  });

  it("passes unprefixed values through decrypt (a keyless server's plaintext rows)", async () => {
    expect(await disabled().decrypt("stored plaintext")).toBe(
      "stored plaintext",
    );
  });

  it("fails LOUD decrypting a prefixed value — never returns ciphertext as-is", async () => {
    const ct = await enabled().encrypt("secret", SCOPE);
    await expect(disabled().decrypt(ct)).rejects.toThrow(
      EncryptionDisabledError,
    );
  });

  it("treats an empty key buffer as disabled, like an absent key", () => {
    expect(SecretService.create(Buffer.alloc(0)).isEnabled()).toBe(false);
  });
});

describe("SecretService error taxonomy", () => {
  it("rejects a wrong-size key at construction", () => {
    expect(() => SecretService.create(Buffer.alloc(16))).toThrow(
      "encryption key must be exactly 32 bytes",
    );
  });

  it("fails with DecryptionFailedError on a tampered ciphertext byte", async () => {
    const svc = enabled();
    const ct = await svc.encrypt("tamper me", SCOPE);
    const sealed = Buffer.from(ct.slice(ENCRYPTED_PREFIX.length), "base64");
    sealed[GCM_NONCE_SIZE] ^= 0xff; // flip one ciphertext bit
    const tampered = ENCRYPTED_PREFIX + sealed.toString("base64");
    await expect(svc.decrypt(tampered)).rejects.toThrow(DecryptionFailedError);
  });

  it("fails with DecryptionFailedError under the wrong key", async () => {
    const ct = await enabled().encrypt("keyed secret", SCOPE);
    await expect(SecretService.create(OTHER_KEY).decrypt(ct)).rejects.toThrow(
      DecryptionFailedError,
    );
  });

  it("fails with InvalidCiphertextError on corrupted base64", async () => {
    await expect(enabled().decrypt("enc:v1:!!!not-base64!!!")).rejects.toThrow(
      InvalidCiphertextError,
    );
  });

  it("fails with InvalidCiphertextError on truncated sealed bytes", async () => {
    const short = Buffer.alloc(GCM_NONCE_SIZE + GCM_TAG_SIZE - 1, 1);
    await expect(
      enabled().decrypt(ENCRYPTED_PREFIX + short.toString("base64")),
    ).rejects.toThrow(InvalidCiphertextError);
  });

  it("fails CLOSED on unregistered-version prefixes as the unavailable arm", async () => {
    // enc:v2: is isEncrypted-matched (fail-open-as-plaintext would be the
    // bug) but has no codec in a v1-only facade, so it refuses as
    // EncryptionUnavailableError — the value may be perfectly valid, the
    // machinery is missing.
    const v1 = await enabled().encrypt("future", SCOPE);
    const v2 = v1.replace("enc:v1:", "enc:v2:");
    await expect(enabled().decrypt(v2)).rejects.toThrow(
      EncryptionUnavailableError,
    );
    await expect(enabled().decrypt(v2)).rejects.toThrow(
      "unsupported encrypted-value version 'v2'",
    );
  });

  it("keeps the taxonomy arms distinguishable by inheritance", () => {
    // The two-armed classification (errors.ts): value-scoped failures are
    // InvalidCiphertextError (incl. DecryptionFailedError); infrastructure
    // failures are EncryptionUnavailableError (incl. the keyless case).
    // The resolution lanes' skip/propagate split branches on exactly this.
    expect(new DecryptionFailedError(new Error("x"))).toBeInstanceOf(
      InvalidCiphertextError,
    );
    expect(new EncryptionDisabledError()).toBeInstanceOf(
      EncryptionUnavailableError,
    );
    expect(new EncryptionDisabledError().message).toBe(
      "encryption is not enabled - no key configured",
    );
    expect(new DecryptionFailedError(new Error("x")).message).toBe(
      "decryption failed - wrong key or tampered data",
    );
  });
});

describe("isCiphertextShaped (the oss#395 boundary guard)", () => {
  it("matches every enc:v<N>: version, not just v1", () => {
    expect(isCiphertextShaped("enc:v1:abc")).toBe(true);
    expect(isCiphertextShaped("enc:v2:abc")).toBe(true);
    expect(isCiphertextShaped("enc:v99:x")).toBe(true);
  });

  it("does not match plaintext, near-misses, or mid-string prefixes", () => {
    expect(isCiphertextShaped("plain")).toBe(false);
    expect(isCiphertextShaped("enc:vX:abc")).toBe(false);
    expect(isCiphertextShaped("enc:v:abc")).toBe(false);
    expect(isCiphertextShaped(" enc:v1:abc")).toBe(false);
    expect(isCiphertextShaped("xenc:v1:abc")).toBe(false);
    expect(isCiphertextShaped("")).toBe(false);
  });

  it("agrees with the instance dispatch (same regex, different intent)", () => {
    const svc = enabled();
    expect(svc.isEncrypted("enc:v3:whatever")).toBe(true);
    expect(svc.isEncrypted("whatever")).toBe(false);
  });
});

// The golden vectors are FROZEN: they pin the enc:v1: format's bytes, so
// every enc:v1: value a store already holds stays decryptable. A change to
// the format is a new version prefix, never an edit to these vectors.
describe("enc:v1: golden vectors", () => {
  interface FixtureEntry {
    name: string;
    plaintext: string;
    ciphertext: string;
  }
  interface Fixture {
    keyBase64: string;
    entries: FixtureEntry[];
  }

  const fixturePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "fixtures",
    "enc-v1-golden-vectors.json",
  );
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;

  it("decrypts every golden ciphertext to its plaintext", async () => {
    const svc = SecretService.create(Buffer.from(fixture.keyBase64, "base64"));
    expect(fixture.entries.length).toBeGreaterThanOrEqual(7);
    for (const entry of fixture.entries) {
      expect(await svc.decrypt(entry.ciphertext), entry.name).toBe(
        entry.plaintext,
      );
    }
  });
});

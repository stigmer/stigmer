/**
 * Pins the SecretService's cross-edition contract: the enc:v1: format
 * (proven against the Go-generated fixture, DD-001), the keyless
 * pass-through/fail-loud asymmetry, encrypt idempotence (the marker
 * round-trip's foundation), the error taxonomy (invalid ciphertext vs
 * decryption failed vs disabled), and the fail-closed handling of
 * future-version prefixes. Ports pkg/encryption/encryption_test.go and
 * adds the adversarial arms the T01 plan lists.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DecryptionFailedError,
  ENCRYPTED_PREFIX,
  EncryptionDisabledError,
  GCM_NONCE_SIZE,
  GCM_TAG_SIZE,
  InvalidCiphertextError,
  SecretService,
  isCiphertextShaped,
} from "../encryption.js";

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 8);

function enabled(): SecretService {
  return SecretService.create(KEY);
}

function disabled(): SecretService {
  return SecretService.create(undefined);
}

describe("SecretService round-trip", () => {
  it("encrypts and decrypts back to the plaintext", () => {
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
      const ct = svc.encrypt(pt);
      expect(ct.startsWith(ENCRYPTED_PREFIX)).toBe(true);
      expect(svc.decrypt(ct)).toBe(pt);
    }
  });

  it("produces a unique nonce per encryption (same plaintext, different ciphertext)", () => {
    const svc = enabled();
    expect(svc.encrypt("same input")).not.toBe(svc.encrypt("same input"));
  });

  it("emits the exact sealed layout: base64(nonce || ct || tag)", () => {
    const svc = enabled();
    const ct = svc.encrypt("abc");
    const sealed = Buffer.from(ct.slice(ENCRYPTED_PREFIX.length), "base64");
    expect(sealed.length).toBe(GCM_NONCE_SIZE + 3 + GCM_TAG_SIZE);
  });

  it("is idempotent on already-prefixed input (the marker-restore round-trip)", () => {
    const svc = enabled();
    const ct = svc.encrypt("stored secret");
    expect(svc.encrypt(ct)).toBe(ct);
  });
});

describe("SecretService disabled (keyless) semantics", () => {
  it("reports disabled and passes plaintext through encrypt unchanged", () => {
    const svc = disabled();
    expect(svc.isEnabled()).toBe(false);
    expect(svc.encrypt("plain")).toBe("plain");
  });

  it("passes unprefixed values through decrypt (legacy plaintext rows)", () => {
    expect(disabled().decrypt("legacy plaintext")).toBe("legacy plaintext");
  });

  it("fails LOUD decrypting a prefixed value — never returns ciphertext as-is", () => {
    const ct = enabled().encrypt("secret");
    expect(() => disabled().decrypt(ct)).toThrow(EncryptionDisabledError);
  });

  it("treats an empty key buffer as disabled, like Go's len(key) == 0", () => {
    expect(SecretService.create(Buffer.alloc(0)).isEnabled()).toBe(false);
  });
});

describe("SecretService error taxonomy", () => {
  it("rejects a wrong-size key at construction", () => {
    expect(() => SecretService.create(Buffer.alloc(16))).toThrow(
      "encryption key must be exactly 32 bytes",
    );
  });

  it("fails with DecryptionFailedError on a tampered ciphertext byte", () => {
    const svc = enabled();
    const ct = svc.encrypt("tamper me");
    const sealed = Buffer.from(ct.slice(ENCRYPTED_PREFIX.length), "base64");
    sealed[GCM_NONCE_SIZE] ^= 0xff; // flip one ciphertext bit
    const tampered = ENCRYPTED_PREFIX + sealed.toString("base64");
    expect(() => svc.decrypt(tampered)).toThrow(DecryptionFailedError);
  });

  it("fails with DecryptionFailedError under the wrong key", () => {
    const ct = enabled().encrypt("keyed secret");
    expect(() => SecretService.create(OTHER_KEY).decrypt(ct)).toThrow(
      DecryptionFailedError,
    );
  });

  it("fails with InvalidCiphertextError on corrupted base64", () => {
    expect(() => enabled().decrypt("enc:v1:!!!not-base64!!!")).toThrow(
      InvalidCiphertextError,
    );
  });

  it("fails with InvalidCiphertextError on truncated sealed bytes", () => {
    const short = Buffer.alloc(GCM_NONCE_SIZE + GCM_TAG_SIZE - 1, 1);
    expect(() =>
      enabled().decrypt(ENCRYPTED_PREFIX + short.toString("base64")),
    ).toThrow(InvalidCiphertextError);
  });

  it("fails CLOSED on future-version prefixes instead of decrypting them as v1", () => {
    // enc:v2: is isEncrypted-matched (fail-open-as-plaintext would be the
    // bug) but not decryptable by this build — Go's TrimPrefix leaves the
    // prefix in place and the strict base64 check rejects it.
    const v1 = enabled().encrypt("future");
    const v2 = v1.replace("enc:v1:", "enc:v2:");
    expect(() => enabled().decrypt(v2)).toThrow(InvalidCiphertextError);
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

describe("cross-edition compatibility (Go-generated fixture, DD-001)", () => {
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
    "go-ciphertext.json",
  );
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;

  it("decrypts every ciphertext the Go implementation produced", () => {
    const svc = SecretService.create(
      Buffer.from(fixture.keyBase64, "base64"),
    );
    expect(fixture.entries.length).toBeGreaterThanOrEqual(7);
    for (const entry of fixture.entries) {
      expect(svc.decrypt(entry.ciphertext), entry.name).toBe(entry.plaintext);
    }
  });
});

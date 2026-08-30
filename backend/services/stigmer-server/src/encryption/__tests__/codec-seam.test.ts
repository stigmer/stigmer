/**
 * Pins the versioned-codec seam (20260830.04 Stage 1, rulings Q2/Q7):
 * read dispatch on the value's own version token, fail-fast write-version
 * resolution, the facade-owned policy layer (idempotent pass-through,
 * unprefixed pass-through, unknown-version refusal on the unavailable
 * arm), the batch verbs and their loop fallbacks, the v2-capped
 * executioncontext lane (the Java encryptAllV2 pin, generalized),
 * reencrypt's three load-bearing rules (upward-only, round-trip-verified,
 * marker-refused, plaintext-sealed), versionOf, and EncryptionScope's
 * validation invariants (the Java EncryptionScopeTest cases). The v1
 * wire format itself is pinned by encryption.test.ts.
 */
import { describe, expect, it } from "vitest";

import type { SecretCodec } from "../codec.js";
import {
  ENCRYPTED_PREFIX,
  EncryptionScope,
  EncryptionUnavailableError,
  InvalidCiphertextError,
  REDACTED_MARKER,
  SecretService,
  StaticKeySecretCodec,
} from "../encryption.js";

const KEY = Buffer.alloc(32, 7);
const SCOPE = EncryptionScope.forOrganization("test-org");

/**
 * A reversible fake "v2": base64 payload behind its own prefix, plus call
 * counters so the tests can prove WHICH codec served a verb and whether
 * the native batch (vs the loop fallback) ran.
 */
function fakeV2(): SecretCodec & {
  encryptCalls: number;
  batchEncryptCalls: number;
  batchDecryptCalls: number;
} {
  const codec = {
    version: "v2",
    encryptCalls: 0,
    batchEncryptCalls: 0,
    batchDecryptCalls: 0,
    encrypt(plaintext: string): Promise<string> {
      codec.encryptCalls += 1;
      return Promise.resolve(
        `enc:v2:${Buffer.from(plaintext, "utf8").toString("base64")}`,
      );
    },
    decrypt(encrypted: string): Promise<string> {
      return Promise.resolve(
        Buffer.from(encrypted.slice("enc:v2:".length), "base64").toString(
          "utf8",
        ),
      );
    },
    encryptAll(
      plaintexts: ReadonlyMap<string, string>,
    ): Promise<Map<string, string>> {
      codec.batchEncryptCalls += 1;
      const out = new Map<string, string>();
      for (const [k, v] of plaintexts) {
        out.set(k, `enc:v2:${Buffer.from(v, "utf8").toString("base64")}`);
      }
      return Promise.resolve(out);
    },
    decryptAll(
      encrypted: ReadonlyMap<string, string>,
    ): Promise<Map<string, string>> {
      codec.batchDecryptCalls += 1;
      const out = new Map<string, string>();
      for (const [k, v] of encrypted) {
        out.set(
          k,
          Buffer.from(v.slice("enc:v2:".length), "base64").toString("utf8"),
        );
      }
      return Promise.resolve(out);
    },
  };
  return codec;
}

/** A v1+v2 facade writing the given version. */
function facadeWith(v2: SecretCodec, writeVersion: string): SecretService {
  return SecretService.withCodecs({
    codecs: new Map<string, SecretCodec>([
      ["v1", new StaticKeySecretCodec(KEY)],
      ["v2", v2],
    ]),
    writeVersion,
  });
}

describe("write-version resolution (fail-fast, the Java @PostConstruct contract)", () => {
  it("refuses a write version with no registered codec, naming the registered set", () => {
    expect(() =>
      SecretService.withCodecs({
        codecs: new Map([["v1", new StaticKeySecretCodec(KEY)]]),
        writeVersion: "v2",
      }),
    ).toThrow(
      "STIGMER_ENCRYPTION_WRITE_VERSION is 'v2' but this deployment has no codec for it (registered: v1)",
    );
  });

  it("refuses an undispatchable version token and a key/version mismatch", () => {
    expect(() =>
      SecretService.withCodecs({
        codecs: new Map([["vault", new StaticKeySecretCodec(KEY)]]),
        writeVersion: "vault",
      }),
    ).toThrow("version tokens must match v<digits>");
    expect(() =>
      SecretService.withCodecs({
        codecs: new Map([["v2", new StaticKeySecretCodec(KEY)]]),
        writeVersion: "v2",
      }),
    ).toThrow("the registry key must equal the codec's own version");
  });
});

describe("read dispatch on the value's own version token", () => {
  it("routes each stored value to its own codec, whatever the write version", async () => {
    const v2 = fakeV2();
    const svc = facadeWith(v2, "v2");
    const v1Value = await SecretService.create(KEY).encrypt("one", SCOPE);
    const v2Value = await v2.encrypt("two", SCOPE);
    expect(await svc.decrypt(v1Value)).toBe("one");
    expect(await svc.decrypt(v2Value)).toBe("two");
  });

  it("writes with exactly the configured codec", async () => {
    const v2 = fakeV2();
    const svc = facadeWith(v2, "v2");
    const sealed = await svc.encrypt("fresh", SCOPE);
    expect(sealed.startsWith("enc:v2:")).toBe(true);
    // No silent upgrades: a stored v1 value carried through encrypt stays v1.
    const v1Value = await SecretService.create(KEY).encrypt("stay", SCOPE);
    expect(await svc.encrypt(v1Value, SCOPE)).toBe(v1Value);
  });

  it("classifies versions through versionOf (the sweep's parse)", () => {
    const svc = SecretService.create(KEY);
    expect(svc.versionOf("enc:v1:abc")).toBe(1);
    expect(svc.versionOf("enc:v12:abc")).toBe(12);
    expect(svc.versionOf("plaintext")).toBeUndefined();
    expect(svc.versionOf("")).toBeUndefined();
    expect(svc.versionOf(REDACTED_MARKER)).toBeUndefined();
  });
});

describe("batch verbs", () => {
  it("encryptAll passes already-encrypted values through and batches the rest natively", async () => {
    const v2 = fakeV2();
    const svc = facadeWith(v2, "v2");
    const preSealed = await SecretService.create(KEY).encrypt("old", SCOPE);
    const input = new Map([
      ["A", "alpha"],
      ["B", preSealed],
      ["C", "gamma"],
    ]);
    const out = await svc.encryptAll(input, SCOPE);
    expect([...out.keys()]).toEqual(["A", "B", "C"]); // input order preserved
    expect(out.get("B")).toBe(preSealed); // no silent upgrade inside a batch
    expect(out.get("A")?.startsWith("enc:v2:")).toBe(true);
    expect(out.get("C")?.startsWith("enc:v2:")).toBe(true);
    expect(v2.batchEncryptCalls).toBe(1); // ONE native batch, not per-value
    expect(v2.encryptCalls).toBe(0);
  });

  it("encryptAll falls back to looping the singular verb for codecs without a native batch (v1)", async () => {
    const svc = SecretService.create(KEY);
    const out = await svc.encryptAll(
      new Map([
        ["A", "alpha"],
        ["B", "beta"],
      ]),
      SCOPE,
    );
    expect(await svc.decrypt(out.get("A") ?? "")).toBe("alpha");
    expect(await svc.decrypt(out.get("B") ?? "")).toBe("beta");
  });

  it("decryptAll groups by version, batching where the codec can and passing plaintext through", async () => {
    const v2 = fakeV2();
    const svc = facadeWith(v2, "v2");
    const v1Value = await SecretService.create(KEY).encrypt("one", SCOPE);
    const v2Value = await v2.encrypt("two", SCOPE);
    const out = await svc.decryptAll(
      new Map([
        ["A", v1Value],
        ["B", v2Value],
        ["C", "plain"],
      ]),
    );
    expect([...out.entries()]).toEqual([
      ["A", "one"],
      ["B", "two"],
      ["C", "plain"],
    ]);
    expect(v2.batchDecryptCalls).toBe(1);
  });

  it("decryptAll refuses a version with no codec as the unavailable arm (whole-batch failure)", async () => {
    const svc = SecretService.create(KEY);
    await expect(
      svc.decryptAll(new Map([["A", "enc:v2:AAAA"]])),
    ).rejects.toThrow(EncryptionUnavailableError);
  });
});

describe("encryptAllAtMostV2 (the executioncontext pin, vault project DD-005)", () => {
  it("uses the write codec at write-version v1 (the OSS default)", async () => {
    const svc = SecretService.create(KEY);
    const out = await svc.encryptAllAtMostV2(new Map([["A", "alpha"]]), SCOPE);
    expect(out.get("A")?.startsWith(ENCRYPTED_PREFIX)).toBe(true);
  });

  it("uses the write codec at write-version v2 (equals the Java pin)", async () => {
    const v2 = fakeV2();
    const svc = facadeWith(v2, "v2");
    const out = await svc.encryptAllAtMostV2(new Map([["A", "alpha"]]), SCOPE);
    expect(out.get("A")?.startsWith("enc:v2:")).toBe(true);
  });

  it("caps at v2 when the write version is above it (the future v3 flip)", async () => {
    const v2 = fakeV2();
    const v3 = { ...fakeV2(), version: "v3" };
    const svc = SecretService.withCodecs({
      codecs: new Map<string, SecretCodec>([
        ["v1", new StaticKeySecretCodec(KEY)],
        ["v2", v2],
        ["v3", v3],
      ]),
      writeVersion: "v3",
    });
    const out = await svc.encryptAllAtMostV2(new Map([["A", "alpha"]]), SCOPE);
    expect(out.get("A")?.startsWith("enc:v2:")).toBe(true);
  });

  it("refuses when the cap is needed but no v2 codec is registered", async () => {
    const v3 = { ...fakeV2(), version: "v3" };
    const svc = SecretService.withCodecs({
      codecs: new Map<string, SecretCodec>([
        ["v1", new StaticKeySecretCodec(KEY)],
        ["v3", v3],
      ]),
      writeVersion: "v3",
    });
    await expect(
      svc.encryptAllAtMostV2(new Map([["A", "alpha"]]), SCOPE),
    ).rejects.toThrow(EncryptionUnavailableError);
  });
});

describe("reencrypt (the sweep's one upgrade door)", () => {
  it("upgrades a lower-version value to the write version, round-trip intact", async () => {
    const v2 = fakeV2();
    const svc = facadeWith(v2, "v2");
    const v1Value = await SecretService.create(KEY).encrypt("secret", SCOPE);
    const upgraded = await svc.reencrypt(v1Value, SCOPE);
    expect(upgraded.startsWith("enc:v2:")).toBe(true);
    expect(await svc.decrypt(upgraded)).toBe("secret");
  });

  it("is UPWARD-ONLY: a value at or above the write version returns unchanged", async () => {
    const v2 = fakeV2();
    // Write version v1, stored value v2 — a rolled-back write-version
    // lever must never mass-downgrade (in a v3 world: mass KV destruction).
    const svc = facadeWith(v2, "v1");
    const v2Value = await v2.encrypt("hold", SCOPE);
    expect(await svc.reencrypt(v2Value, SCOPE)).toBe(v2Value);
    // Same version is also unchanged (idempotent for converged rows).
    const v1Svc = SecretService.create(KEY);
    const v1Value = await v1Svc.encrypt("hold", SCOPE);
    expect(await v1Svc.reencrypt(v1Value, SCOPE)).toBe(v1Value);
  });

  it("seals bare plaintext (the fail-open-era damage, cloud #226)", async () => {
    const svc = SecretService.create(KEY);
    const sealed = await svc.reencrypt("stored plaintext", SCOPE);
    expect(sealed.startsWith(ENCRYPTED_PREFIX)).toBe(true);
    expect(await svc.decrypt(sealed)).toBe("stored plaintext");
  });

  it("refuses the literal redaction marker as value-scoped corruption", async () => {
    const svc = SecretService.create(KEY);
    await expect(svc.reencrypt(REDACTED_MARKER, SCOPE)).rejects.toThrow(
      InvalidCiphertextError,
    );
  });

  it("passes empty values through unchanged", async () => {
    expect(await SecretService.create(KEY).reencrypt("", SCOPE)).toBe("");
  });

  it("round-trip-verifies BEFORE returning: a lying codec is caught, nothing persisted", async () => {
    const lying: SecretCodec = {
      version: "v2",
      encrypt: () => Promise.resolve("enc:v2:bm90LXRoZS1zZWNyZXQ="), // "not-the-secret"
      decrypt: () => Promise.resolve("not-the-secret"),
    };
    const svc = facadeWith(lying, "v2");
    await expect(svc.reencrypt("the-secret", SCOPE)).rejects.toThrow(
      "re-encryption round-trip verification failed",
    );
  });
});

describe("EncryptionScope (the Java record's validation invariants)", () => {
  it("derives org-<slug> tenancy and the platform tenant", () => {
    const org = EncryptionScope.forOrganization("acme-corp");
    expect(org.tenantSegment).toBe("org-acme-corp");
    expect(org.kekKeyName()).toBe("org-acme-corp");
    expect(org.isLocated()).toBe(false);

    const platform = EncryptionScope.forPlatformResource(
      "cursoraccount",
      "acc_1",
    );
    expect(platform.tenantSegment).toBe("platform");
    expect(platform.isLocated()).toBe(true);
  });

  it("rejects invalid org slugs (the metadata.proto contract, verbatim)", () => {
    for (const bad of ["", "A", "a", "-x", "x-", "org platform", "Ürg"]) {
      expect(() => EncryptionScope.forOrganization(bad)).toThrow(
        "encryption scope requires a valid org slug",
      );
    }
  });

  it("rejects malformed locations and keyNames without a location", () => {
    expect(() =>
      EncryptionScope.forOrganizationResource("acme", "Channel_App", "slug"),
    ).toThrow("encryption scope kind must be a lowercase server-side constant");
    expect(() =>
      EncryptionScope.forOrganizationResource("acme", "channelapp", "  "),
    ).toThrow("encryption scope id must not be blank");
    expect(() =>
      EncryptionScope.forOrganization("acme").withKeyName("client_secret"),
    ).toThrow("keyName requires a located scope");
    expect(() =>
      EncryptionScope.forOrganizationResource(
        "acme",
        "channelapp",
        "s",
      ).withKeyName(""),
    ).toThrow("keyName must not be empty");
  });

  it("attaches keyNames to located scopes for singular encrypts", () => {
    const located = EncryptionScope.forOrganizationResource(
      "acme",
      "environment",
      "prod-env",
    ).withKeyName("API_KEY");
    expect(located.keyName).toBe("API_KEY");
    expect(located.kind).toBe("environment");
    expect(located.id).toBe("prod-env");
  });
});

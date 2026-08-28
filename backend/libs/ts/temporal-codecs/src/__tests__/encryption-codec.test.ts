/**
 * Unit tests for the payload-encryption codec (stigmer-cloud#227).
 *
 * Covers the codec in isolation, its composition with the claim-check
 * codec (order is load-bearing: encrypt before relocate, so object
 * storage only ever sees ciphertext), the config loader's fail-fast
 * contract, and the committed cross-language conformance fixture that
 * pins the envelope format the Java decode-only codec (stigmer-cloud
 * temporal-starter) must match.
 */

import { describe, it, expect, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Payload } from "@temporalio/common";
import { EncryptionPayloadCodec } from "../encryption/payload-codec.js";
import { loadPayloadEncryptionConfig } from "../encryption/config.js";
import type { PayloadEncryptionConfig } from "../encryption/config.js";
import { ClaimcheckPayloadCodec } from "../claimcheck/payload-codec.js";
import { makeInMemoryClaimcheckStorage } from "../__test-utils__/fake-claimcheck-storage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeKeyConfig(
  overrides: Partial<PayloadEncryptionConfig> = {},
): PayloadEncryptionConfig {
  return {
    primary: { keyId: "test-key-1", key: randomBytes(32) },
    ...overrides,
  };
}

function makeJsonPayload(value: unknown): Payload {
  return {
    metadata: { encoding: Buffer.from("json/plain") },
    data: Buffer.from(JSON.stringify(value)),
  };
}

function metadataString(payload: Payload, key: string): string | undefined {
  const bytes = payload.metadata?.[key];
  return bytes ? Buffer.from(bytes).toString("utf-8") : undefined;
}

describe("EncryptionPayloadCodec", () => {
  it("round-trips a payload, restoring metadata and data exactly", async () => {
    const codec = new EncryptionPayloadCodec(makeKeyConfig());
    const original = makeJsonPayload({ secret: "s3cret-value" });

    const [encoded] = await codec.encode([original]);
    expect(metadataString(encoded, "encoding")).toBe("binary/encrypted");
    expect(metadataString(encoded, "encryption-key-id")).toBe("test-key-1");
    expect(Buffer.from(encoded.data!).includes("s3cret-value")).toBe(false);

    const [decoded] = await codec.decode([encoded]);
    expect(metadataString(decoded, "encoding")).toBe("json/plain");
    expect(Buffer.from(decoded.data!)).toEqual(original.data);
  });

  it("passes through payloads it did not encode", async () => {
    const codec = new EncryptionPayloadCodec(makeKeyConfig());
    const plaintext = makeJsonPayload({ from: "java-orchestrator" });
    const [decoded] = await codec.decode([plaintext]);
    expect(decoded).toBe(plaintext);
  });

  it("skips data-less payloads on encode (binary/null void results)", async () => {
    const codec = new EncryptionPayloadCodec(makeKeyConfig());
    const nullPayload: Payload = {
      metadata: { encoding: Buffer.from("binary/null") },
      data: undefined,
    };
    const [encoded] = await codec.encode([nullPayload]);
    expect(encoded).toBe(nullPayload);
  });

  it("fails closed on tampered ciphertext", async () => {
    const codec = new EncryptionPayloadCodec(makeKeyConfig());
    const [encoded] = await codec.encode([makeJsonPayload({ a: 1 })]);

    const tampered = Buffer.from(encoded.data!);
    tampered[tampered.length - 1] ^= 0xff;

    await expect(
      codec.decode([{ metadata: encoded.metadata, data: tampered }]),
    ).rejects.toThrow(/corrupt or the configured key does not match/);
  });

  it("fails closed on an unknown key id", async () => {
    const writer = new EncryptionPayloadCodec(makeKeyConfig());
    const [encoded] = await writer.encode([makeJsonPayload({ a: 1 })]);

    const reader = new EncryptionPayloadCodec(
      makeKeyConfig({ primary: { keyId: "other-key", key: randomBytes(32) } }),
    );
    await expect(reader.decode([encoded])).rejects.toThrow(
      /unknown key id 'test-key-1'/,
    );
  });

  it("fails closed when the key id metadata is missing", async () => {
    const codec = new EncryptionPayloadCodec(makeKeyConfig());
    const [encoded] = await codec.encode([makeJsonPayload({ a: 1 })]);

    const stripped: Payload = {
      metadata: { encoding: Buffer.from("binary/encrypted") },
      data: encoded.data,
    };
    await expect(codec.decode([stripped])).rejects.toThrow(
      /missing its encryption-key-id/,
    );
  });

  it("decodes payloads written under the secondary key (rotation window)", async () => {
    const oldKey = { keyId: "2026-01", key: randomBytes(32) };
    const writer = new EncryptionPayloadCodec({ primary: oldKey });
    const [encoded] = await writer.encode([makeJsonPayload({ rotated: true })]);

    const rotatedReader = new EncryptionPayloadCodec({
      primary: { keyId: "2026-08", key: randomBytes(32) },
      secondary: oldKey,
    });
    const [decoded] = await rotatedReader.decode([encoded]);
    expect(JSON.parse(Buffer.from(decoded.data!).toString())).toEqual({
      rotated: true,
    });
  });

  // The resolveKey seam (C4 Stage 2): decrypt-only fallback for key ids
  // outside the static pair — the cloud server's database-resident rpk_
  // keys. Pinned properties: resolved keys decode, resolved material is
  // cached (one lookup per id per process), misses are NOT cached, an
  // unresolvable id keeps the fail-closed unknown-key-id throw, and
  // encode never consults the resolver.
  describe("resolveKey fallback", () => {
    it("decodes a payload under a resolver-supplied key and caches the material", async () => {
      const runnerKey = { keyId: "rpk_abc123", key: randomBytes(32) };
      const writer = new EncryptionPayloadCodec({ primary: runnerKey });
      const [encoded] = await writer.encode([
        makeJsonPayload({ desktop: true }),
      ]);

      const lookups: string[] = [];
      const reader = new EncryptionPayloadCodec({
        ...makeKeyConfig(),
        resolveKey: async (keyId) => {
          lookups.push(keyId);
          return keyId === runnerKey.keyId ? runnerKey.key : undefined;
        },
      });

      const [first] = await reader.decode([encoded]);
      expect(JSON.parse(Buffer.from(first.data!).toString())).toEqual({
        desktop: true,
      });

      const [second] = await reader.decode([encoded]);
      expect(JSON.parse(Buffer.from(second.data!).toString())).toEqual({
        desktop: true,
      });
      expect(lookups).toEqual(["rpk_abc123"]);
    });

    it("fails closed when the resolver does not know the key id, and retries on the next decode", async () => {
      const runnerKey = { keyId: "rpk_late", key: randomBytes(32) };
      const writer = new EncryptionPayloadCodec({ primary: runnerKey });
      const [encoded] = await writer.encode([makeJsonPayload({ a: 1 })]);

      let known = false;
      const lookups: string[] = [];
      const reader = new EncryptionPayloadCodec({
        ...makeKeyConfig(),
        resolveKey: async (keyId) => {
          lookups.push(keyId);
          return known && keyId === runnerKey.keyId ? runnerKey.key : undefined;
        },
      });

      await expect(reader.decode([encoded])).rejects.toThrow(
        /unknown key id 'rpk_late'/,
      );

      // The miss was not cached: once the key exists (minted after this
      // process booted), the next decode finds it.
      known = true;
      const [decoded] = await reader.decode([encoded]);
      expect(JSON.parse(Buffer.from(decoded.data!).toString())).toEqual({
        a: 1,
      });
      expect(lookups).toEqual(["rpk_late", "rpk_late"]);
    });

    it("never consults the resolver for the static keys or on encode", async () => {
      const lookups: string[] = [];
      const codec = new EncryptionPayloadCodec({
        ...makeKeyConfig(),
        resolveKey: async (keyId) => {
          lookups.push(keyId);
          return undefined;
        },
      });

      const [encoded] = await codec.encode([makeJsonPayload({ b: 2 })]);
      const [decoded] = await codec.decode([encoded]);
      expect(JSON.parse(Buffer.from(decoded.data!).toString())).toEqual({
        b: 2,
      });
      expect(lookups).toEqual([]);
    });
  });
});

describe("composition with claim-check (encrypt, then relocate)", () => {
  it("stores only ciphertext in object storage and round-trips exactly", async () => {
    const { storage, blobs } = makeInMemoryClaimcheckStorage();
    const encryption = new EncryptionPayloadCodec(makeKeyConfig());
    const claimcheck = new ClaimcheckPayloadCodec(storage, {
      enabled: true,
      thresholdBytes: 128,
      compressionEnabled: false,
      keyPrefix: "claimcheck/",
    });

    const secret = "very-large-and-very-secret-".repeat(32);
    const original = makeJsonPayload({ secret });

    // Temporal applies codec arrays in order on encode, reverse on decode.
    const [encrypted] = await encryption.encode([original]);
    const [relocated] = await claimcheck.encode([encrypted]);
    expect(metadataString(relocated, "encoding")).toBe("binary/claimcheck");

    expect(blobs.size).toBe(1);
    const blob: Buffer = blobs.values().next().value!;
    expect(blob.includes("very-large-and-very-secret-")).toBe(false);

    const [restored] = await claimcheck.decode([relocated]);
    const [decrypted] = await encryption.decode([restored]);
    expect(metadataString(decrypted, "encoding")).toBe("json/plain");
    expect(Buffer.from(decrypted.data!)).toEqual(original.data);
  });
});

describe("loadPayloadEncryptionConfig", () => {
  const ENV_VARS = [
    "STIGMER_PAYLOAD_ENCRYPTION_KEY",
    "STIGMER_PAYLOAD_ENCRYPTION_KEY_ID",
    "STIGMER_PAYLOAD_ENCRYPTION_SECONDARY_KEY",
    "STIGMER_PAYLOAD_ENCRYPTION_SECONDARY_KEY_ID",
  ];

  // Consumers inject their secret custody (see SecretReader); a plain env
  // read is exactly what these tests exercised before the extraction, when
  // the runner's getRunnerSecret fell back to process.env with no capture.
  const readEnv = (name: string) => process.env[name];

  afterEach(() => {
    for (const name of ENV_VARS) delete process.env[name];
  });

  it("returns undefined when no key is configured", () => {
    expect(loadPayloadEncryptionConfig(readEnv)).toBeUndefined();
  });

  it("loads primary and secondary keys", () => {
    process.env.STIGMER_PAYLOAD_ENCRYPTION_KEY =
      randomBytes(32).toString("base64");
    process.env.STIGMER_PAYLOAD_ENCRYPTION_KEY_ID = "k2";
    process.env.STIGMER_PAYLOAD_ENCRYPTION_SECONDARY_KEY =
      randomBytes(32).toString("base64");
    process.env.STIGMER_PAYLOAD_ENCRYPTION_SECONDARY_KEY_ID = "k1";

    const config = loadPayloadEncryptionConfig(readEnv);
    expect(config?.primary.keyId).toBe("k2");
    expect(config?.primary.key.length).toBe(32);
    expect(config?.secondary?.keyId).toBe("k1");
  });

  it("fails the boot when a key is set without an id", () => {
    process.env.STIGMER_PAYLOAD_ENCRYPTION_KEY =
      randomBytes(32).toString("base64");
    expect(() => loadPayloadEncryptionConfig(readEnv)).toThrow(
      /STIGMER_PAYLOAD_ENCRYPTION_KEY_ID is required/,
    );
  });

  it("fails the boot on a key of the wrong length", () => {
    process.env.STIGMER_PAYLOAD_ENCRYPTION_KEY =
      randomBytes(16).toString("base64");
    process.env.STIGMER_PAYLOAD_ENCRYPTION_KEY_ID = "k1";
    expect(() => loadPayloadEncryptionConfig(readEnv)).toThrow(
      /must decode to 32 bytes/,
    );
  });

  // Server-managed key material from getRunnerBootstrapConfig (stigmer#398):
  // desktop-class runners receive a per-identity key at bootstrap instead of
  // env config. The env key is the operator's explicit choice and must win.
  describe("bootstrap-delivered keys", () => {
    const bootstrapKeys = () => ({
      key: randomBytes(32).toString("base64"),
      keyId: "identity-key-v1",
      secondaryKey: randomBytes(32).toString("base64"),
      secondaryKeyId: "identity-key-v0",
    });

    it("enables encryption from bootstrap material when no env key is set", () => {
      const config = loadPayloadEncryptionConfig(readEnv, bootstrapKeys());
      expect(config?.primary.keyId).toBe("identity-key-v1");
      expect(config?.primary.key.length).toBe(32);
      expect(config?.secondary?.keyId).toBe("identity-key-v0");
    });

    it("env-configured key wins over bootstrap material", () => {
      process.env.STIGMER_PAYLOAD_ENCRYPTION_KEY =
        randomBytes(32).toString("base64");
      process.env.STIGMER_PAYLOAD_ENCRYPTION_KEY_ID = "env-key";

      const config = loadPayloadEncryptionConfig(readEnv, bootstrapKeys());
      expect(config?.primary.keyId).toBe("env-key");
      expect(config?.secondary).toBeUndefined();
    });

    it("fails the boot on a bootstrap key without its id (server contract violation)", () => {
      expect(() =>
        loadPayloadEncryptionConfig(readEnv, {
          key: randomBytes(32).toString("base64"),
        }),
      ).toThrow(/payload_encryption_key_id/);
    });

    it("fails the boot on a malformed bootstrap key rather than running plaintext", () => {
      expect(() =>
        loadPayloadEncryptionConfig(readEnv, {
          key: randomBytes(16).toString("base64"),
          keyId: "identity-key-v1",
        }),
      ).toThrow(/must decode to 32 bytes/);
    });

    it("fails the boot on a bootstrap secondary key without its id", () => {
      expect(() =>
        loadPayloadEncryptionConfig(readEnv, {
          key: randomBytes(32).toString("base64"),
          keyId: "identity-key-v1",
          secondaryKey: randomBytes(32).toString("base64"),
        }),
      ).toThrow(/payload_encryption_secondary_key_id/);
    });
  });
});

describe("cross-language conformance fixture", () => {
  // The committed fixture pins the envelope as a wire contract. A copy
  // lives in stigmer-cloud (temporal-starter test resources) where the
  // Java decode-only codec must decrypt it to the same payload. Never
  // regenerate it casually: changing the fixture means changing the
  // cross-SDK envelope, which requires both implementations to move in
  // lockstep.
  it("decrypts the committed fixture to the expected payload", async () => {
    const fixture = JSON.parse(
      readFileSync(
        join(__dirname, "fixtures", "encrypted-payload-fixture.json"),
        "utf-8",
      ),
    );

    const codec = new EncryptionPayloadCodec({
      primary: {
        keyId: fixture.keyId,
        key: Buffer.from(fixture.keyBase64, "base64"),
      },
    });

    const encrypted: Payload = {
      metadata: Object.fromEntries(
        Object.entries(
          fixture.encrypted.metadataBase64 as Record<string, string>,
        ).map(([k, v]) => [k, Buffer.from(v, "base64")]),
      ),
      data: Buffer.from(fixture.encrypted.dataBase64, "base64"),
    };

    const [decoded] = await codec.decode([encrypted]);
    expect(metadataString(decoded, "encoding")).toBe("json/plain");
    expect(Buffer.from(decoded.data!).toString("utf-8")).toBe(
      fixture.original.dataJson,
    );
  });
});

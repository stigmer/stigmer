/**
 * Pins the apikey domain — the key-material contract (byte-format parity
 * with the cloud Java library) and the composed-server behaviors the
 * conformance suite cannot express cross-edition:
 *
 *   - the plaintext leaves the server EXACTLY once, in spec.key_hash of
 *     the create response; the store and every later read hold the hash;
 *   - the client can never choose key material (request-carried
 *     key_hash/fingerprint are overwritten on create);
 *   - update immutability (ruling Q9 — the security divergence): a
 *     request that rewrites key_hash/fingerprint persists the STORED
 *     values; only the expiry fields move;
 *   - getByKeyHash resolves by the stored hash and answers the
 *     byte-pinned "ApiKey not found" for an unknown or deleted hash —
 *     deletion takes effect on the very next lookup (no cache).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import { ApiKeyQueryController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/query_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import {
  API_KEY_PREFIX,
  fingerprintOf,
  generateApiKeyPlaintext,
  hashApiKey,
  isApiKeyToken,
} from "../keymaterial.js";
import { API_KEY_NOT_FOUND_BY_HASH_MESSAGE } from "../steps.js";

describe("key material (Java library byte-format parity)", () => {
  it("generates stk_-prefixed Base64URL tokens with 32 bytes of entropy", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 32; i += 1) {
      const token = generateApiKeyPlaintext();
      // 32 bytes → 43 unpadded Base64URL chars after the prefix.
      expect(token).toMatch(/^stk_[A-Za-z0-9_-]{43}$/);
      seen.add(token);
    }
    expect(seen.size).toBe(32);
  });

  it("hashes with SHA-256 Base64URL no padding (the Java hasher's vector)", () => {
    // Precomputed: base64url(sha256("stk_test")) — any divergence here is
    // a storage-compatibility break with keys hashed by the Java service.
    expect(hashApiKey("stk_test")).toBe(
      "JDbciNJDsor0_cZpqFjseFSBDlsVDoKa4uZp27wbOMI",
    );
    expect(() => hashApiKey("")).toThrow("token must not be null or empty");
  });

  it("fingerprints the last 6 chars, whole token when shorter", () => {
    expect(fingerprintOf("stk_abcdef123456")).toBe("123456");
    expect(fingerprintOf("stk_a")).toBe("stk_a");
    expect(fingerprintOf(generateApiKeyPlaintext())).toHaveLength(6);
  });

  it("claims the stk_ prefix case-insensitively, passes everything else", () => {
    expect(isApiKeyToken("stk_abc")).toBe(true);
    expect(isApiKeyToken("STK_abc")).toBe(true);
    expect(isApiKeyToken("sTk_abc")).toBe(true);
    expect(isApiKeyToken("eyJhbGciOi...")).toBe(false);
    expect(isApiKeyToken("")).toBe(false);
    expect(isApiKeyToken("stk")).toBe(false);
  });
});

describe("apikey domain (composed server)", () => {
  let dir: string;
  let server: ComposedServer;
  let transport: Transport;
  let command: Client<typeof ApiKeyCommandController>;
  let query: Client<typeof ApiKeyQueryController>;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "apikey-domain-test-"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        TEMPORAL_HOST_PORT: "127.0.0.1:1",
        DB_PATH: path.join(dir, "stigmer.db"),
        STORAGE_PATH: path.join(dir, "storage"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      }),
      logger: createLogger({ level: "error", pretty: false, write: () => {} }),
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
    command = createClient(ApiKeyCommandController, transport);
    query = createClient(ApiKeyQueryController, transport);
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  let seq = 0;
  function keyInput(extras?: {
    keyHash?: string;
    fingerprint?: string;
    expiresAt?: Date;
    neverExpires?: boolean;
  }) {
    seq += 1;
    return {
      apiVersion: "iam.stigmer.ai/v1",
      kind: "ApiKey",
      metadata: { name: `test key ${seq}`, org: "local" },
      spec: {
        ...(extras?.keyHash !== undefined ? { keyHash: extras.keyHash } : {}),
        ...(extras?.fingerprint !== undefined
          ? { fingerprint: extras.fingerprint }
          : {}),
        ...(extras?.expiresAt !== undefined
          ? { expiresAt: timestampFromDate(extras.expiresAt) }
          : {}),
        ...(extras?.neverExpires !== undefined
          ? { neverExpires: extras.neverExpires }
          : {}),
      },
    };
  }

  it("create returns the plaintext once; the store holds the hash", async () => {
    const created = await command.create(keyInput());
    const plaintext = created.spec?.keyHash ?? "";
    expect(plaintext.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(created.spec?.fingerprint).toBe(fingerprintOf(plaintext));
    expect(created.metadata?.id).toMatch(/^key_/);
    expect(created.status?.audit?.specAudit?.event).toBe("created");

    const fetched = await query.get({ value: created.metadata?.id ?? "" });
    expect(fetched.spec?.keyHash).toBe(hashApiKey(plaintext));
    expect(fetched.spec?.keyHash).not.toBe(plaintext);
  });

  it("create overwrites client-supplied key material", async () => {
    const created = await command.create(
      keyInput({ keyHash: "attacker-chosen", fingerprint: "forged" }),
    );
    expect(created.spec?.keyHash?.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(created.spec?.fingerprint).not.toBe("forged");

    const stored = await query.get({ value: created.metadata?.id ?? "" });
    expect(stored.spec?.keyHash).not.toBe("attacker-chosen");
  });

  it("getByKeyHash resolves the stored hash; unknown hash is the pinned NotFound", async () => {
    const created = await command.create(keyInput());
    const plaintext = created.spec?.keyHash ?? "";

    const found = await query.getByKeyHash({ value: hashApiKey(plaintext) });
    expect(found.metadata?.id).toBe(created.metadata?.id);
    // The lookup response carries the stored hash — never the plaintext.
    expect(found.spec?.keyHash).toBe(hashApiKey(plaintext));

    const missing = query.getByKeyHash({ value: hashApiKey("stk_unknown") });
    await expect(missing).rejects.toSatisfy((error: unknown) => {
      const connectError = ConnectError.from(error);
      expect(connectError.code).toBe(Code.NotFound);
      expect(connectError.rawMessage).toBe(API_KEY_NOT_FOUND_BY_HASH_MESSAGE);
      return true;
    });
  });

  it("update moves expiry fields only — key material is immutable (Q9)", async () => {
    const created = await command.create(keyInput());
    const plaintext = created.spec?.keyHash ?? "";
    const storedHash = hashApiKey(plaintext);
    const expiry = new Date("2030-01-01T00:00:00Z");

    const updated = await command.update({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "ApiKey",
      metadata: {
        id: created.metadata?.id ?? "",
        name: created.metadata?.name ?? "",
        org: created.metadata?.org ?? "",
      },
      spec: {
        // A hash the caller knows the plaintext of — the impersonation
        // attempt Q9 closes. Must be ignored.
        keyHash: hashApiKey("stk_attacker-known-plaintext"),
        fingerprint: "forged",
        expiresAt: timestampFromDate(expiry),
        neverExpires: true,
      },
    });

    expect(updated.spec?.keyHash).toBe(storedHash);
    expect(updated.spec?.fingerprint).toBe(fingerprintOf(plaintext));
    expect(updated.spec?.neverExpires).toBe(true);
    expect(updated.spec?.expiresAt?.seconds).toBe(
      BigInt(Math.floor(expiry.getTime() / 1000)),
    );

    // And the attacker-known hash resolves NOTHING.
    const probe = query.getByKeyHash({
      value: hashApiKey("stk_attacker-known-plaintext"),
    });
    await expect(probe).rejects.toSatisfy((error: unknown) => {
      expect(ConnectError.from(error).code).toBe(Code.NotFound);
      return true;
    });
  });

  it("delete revokes on the very next lookup (no cache)", async () => {
    const created = await command.create(keyInput());
    const plaintext = created.spec?.keyHash ?? "";
    const id = created.metadata?.id ?? "";

    const deleted = await command.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);

    const byId = query.get({ value: id });
    await expect(byId).rejects.toSatisfy((error: unknown) => {
      expect(ConnectError.from(error).code).toBe(Code.NotFound);
      return true;
    });
    const byHash = query.getByKeyHash({ value: hashApiKey(plaintext) });
    await expect(byHash).rejects.toSatisfy((error: unknown) => {
      expect(ConnectError.from(error).code).toBe(Code.NotFound);
      return true;
    });
  });

  it("findAll lists stored keys with hashes, never plaintext", async () => {
    const created = await command.create(keyInput());
    const plaintext = created.spec?.keyHash ?? "";

    const all = await query.findAll({});
    const mine = all.entries.find(
      (entry) => entry.metadata?.id === created.metadata?.id,
    );
    expect(mine).toBeDefined();
    expect(mine?.spec?.keyHash).toBe(hashApiKey(plaintext));
  });
});
